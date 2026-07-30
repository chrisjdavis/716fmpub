/// <reference path="./scrobbles.d.ts" />
import {
  LastfmProviderApiError,
  LastfmUsernameNotFoundError,
  LastfmProviderValidationError,
} from "./errors.js";
import { mapLastfmRecentTrackWire, type LastfmRecentTrackWire } from "./mapLastfmTrack.js";
import type { LastfmImportListenEvent, LastfmProviderFetchConfig } from "./types.js";
import { lookupLastfmUsername } from "./validateUsername.js";

const LASTFM_API = "https://ws.audioscrobbler.com/2.0/" as const;
const DEFAULT_MAX_RETRIES = 5 as const;
const RETRY_DELAY_BASE_MS = 100 as const;
const RETRY_BASE = 2 as const;

type LastfmRecentTracksAttrs = Readonly<{
  total?: string;
  page?: string;
  perPage?: string;
  totalPages?: string;
}>;

type LastfmRecentTracksBody = Readonly<{
  recenttracks?: Readonly<{
    "@attr"?: LastfmRecentTracksAttrs;
    track?: LastfmRecentTrackWire | readonly LastfmRecentTrackWire[];
  }>;
  error?: number;
  message?: string;
}>;

function assertNonEmptyApiKey(apiKey: string): void {
  if (apiKey.trim() === "") {
    throw new LastfmProviderValidationError("Last.fm apiKey must be a non-empty string");
  }
}

function assertUsername(username: string): void {
  const u = username.trim();
  if (u === "") {
    throw new LastfmProviderValidationError("Last.fm username must be a non-empty string");
  }
}

function assertLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new LastfmProviderValidationError(
      "limitPerPage must be an integer between 1 and 200",
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLastfmJsonError(body: unknown): body is { error: number; message: string } {
  return (
    isRecord(body) &&
    typeof body.error === "number" &&
    typeof body.message === "string"
  );
}

/**
 * Last.fm JSON `error` codes that are worth retrying (transient service / rate limit).
 * See https://www.last.fm/api/errorcodes — all other codes are treated as permanent.
 */
const RETRYABLE_LASTFM_JSON_ERROR_CODES = new Set<number>([
  8, // Operation failed — often transient
  11, // Service offline
  16, // Temporary error
  29, // Rate limit exceeded
]);

export function isRetryableLastfmJsonErrorCode(code: number): boolean {
  return RETRYABLE_LASTFM_JSON_ERROR_CODES.has(code);
}

function asTrackArray(track: unknown): readonly LastfmRecentTrackWire[] {
  if (track === undefined) {
    return [];
  }
  return Array.isArray(track)
    ? track.map((item) => item as LastfmRecentTrackWire)
    : [track as LastfmRecentTrackWire];
}

function lastDatedUts(tracks: readonly LastfmRecentTrackWire[]): number | null {
  for (let i = tracks.length - 1; i >= 0; i -= 1) {
    const uts = tracks[i]?.date?.uts;
    if (typeof uts === "string" && /^\d+$/.test(uts)) {
      return Number(uts);
    }
  }
  return null;
}

async function fetchRecentTracksBody(params: {
  apiKey: string;
  username: string;
  limit: number;
  fromUnix?: number;
  toUnix?: number;
}): Promise<LastfmRecentTracksBody> {
  const url = new URL(LASTFM_API);
  url.searchParams.set("method", "user.getrecenttracks");
  url.searchParams.set("user", params.username);
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("format", "json");
  url.searchParams.set("extended", "1");
  url.searchParams.set("limit", String(params.limit));
  if (params.fromUnix !== undefined) {
    url.searchParams.set("from", String(params.fromUnix));
  }
  if (params.toUnix !== undefined) {
    url.searchParams.set("to", String(params.toUnix));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "716fm.com lastfm-provider",
      },
    });
  } catch (cause) {
    throw new LastfmProviderApiError("Last.fm recent tracks request failed", {
      cause,
    });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new LastfmProviderApiError(
      "Last.fm recent tracks response was not valid JSON",
      { httpStatus: response.status, cause },
    );
  }

  if (!response.ok) {
    throw new LastfmProviderApiError(`Last.fm HTTP ${response.status}`, {
      httpStatus: response.status,
    });
  }

  if (!isRecord(body)) {
    throw new LastfmProviderApiError(
      "Last.fm recent tracks response was not a JSON object",
      { httpStatus: response.status },
    );
  }

  return body as LastfmRecentTracksBody;
}

async function fetchRecentTracksBodyWithRetries(params: {
  apiKey: string;
  username: string;
  limit: number;
  fromUnix?: number;
  toUnix?: number;
  maxRetries: number;
}): Promise<LastfmRecentTracksBody> {
  for (let attempt = 0; ; attempt += 1) {
    const body = await fetchRecentTracksBody(params);
    if (!isLastfmJsonError(body)) {
      return body;
    }
    if (
      !isRetryableLastfmJsonErrorCode(body.error) ||
      attempt >= params.maxRetries
    ) {
      throw new LastfmProviderApiError(body.message, {
        lastfmError: body.error,
      });
    }
    await sleep(RETRY_BASE ** (attempt + 1) * RETRY_DELAY_BASE_MS);
  }
}

/**
 * Yields one array per Last.fm page.
 * Validates the username up front so invalid users map to `LastfmUsernameNotFoundError`.
 */
export async function* fetchLastfmRecentTrackPages(
  config: LastfmProviderFetchConfig,
): AsyncGenerator<readonly LastfmImportListenEvent[], void, void> {
  assertNonEmptyApiKey(config.apiKey);
  assertUsername(config.username);
  assertLimit(config.limitPerPage);

  const username = config.username.trim();

  const lookup = await lookupLastfmUsername({ apiKey: config.apiKey, username });
  if (!lookup.ok) {
    if (lookup.kind === "invalid_username") {
      throw new LastfmUsernameNotFoundError(lookup.message);
    }
    throw new LastfmProviderApiError(lookup.message, {
      httpStatus: lookup.httpStatus,
      lastfmError: lookup.lastfmError,
    });
  }

  const limit = config.limitPerPage ?? 50;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  let nextTo = config.toUnix;

  try {
    while (true) {
      const body = await fetchRecentTracksBodyWithRetries({
        apiKey: config.apiKey,
        username,
        limit,
        fromUnix: config.fromUnix,
        toUnix: nextTo,
        maxRetries,
      });
      const recent = body.recenttracks;
      const attrs = recent?.["@attr"];
      if (!recent || !attrs) {
        throw new LastfmProviderApiError(
          "Last.fm recent tracks response missing recenttracks.@attr",
        );
      }

      if (attrs.total === "0" || attrs.totalPages === "0") {
        return;
      }

      const tracks = asTrackArray(recent.track);
      const datedTracks = tracks.filter((track) => track.date !== undefined);
      if (datedTracks.length === 0) {
        return;
      }

      yield datedTracks.map((track) => mapLastfmRecentTrackWire(track));

      const oldestUts = lastDatedUts(datedTracks);
      if (oldestUts === null || oldestUts === nextTo) {
        return;
      }
      nextTo = oldestUts;
    }
  } catch (cause) {
    if (cause instanceof LastfmUsernameNotFoundError) {
      throw cause;
    }
    if (cause instanceof LastfmProviderValidationError) {
      throw cause;
    }
    if (cause instanceof LastfmProviderApiError) {
      throw cause;
    }
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new LastfmProviderApiError(
      `Last.fm recent tracks fetch failed: ${message}`,
      { cause },
    );
  }
}
