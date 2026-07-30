import { LastfmProviderApiError } from "./errors.js";

const LASTFM_API = "https://ws.audioscrobbler.com/2.0/" as const;

/** Last.fm: User not found (invalid username). */
export const LASTFM_ERROR_USER_NOT_FOUND = 6 as const;

type LastfmJsonError = Readonly<{ error: number; message: string }>;

type LastfmUserGetInfoOk = Readonly<{ user?: unknown }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLastfmErrorBody(body: unknown): body is LastfmJsonError {
  if (!isRecord(body)) {
    return false;
  }
  return typeof body.error === "number" && typeof body.message === "string";
}

export type UsernameLookupResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      kind: "invalid_username";
      message: string;
    }>
  | Readonly<{
      ok: false;
      kind: "api_error";
      message: string;
      httpStatus: number;
      lastfmError?: number;
    }>;

/**
 * Calls `user.getinfo` so invalid usernames surface as an explicit outcome
 * instead of opaque retries inside `scrobbles`.
 */
export async function lookupLastfmUsername(params: {
  apiKey: string;
  username: string;
}): Promise<UsernameLookupResult> {
  const url = new URL(LASTFM_API);
  url.searchParams.set("method", "user.getinfo");
  url.searchParams.set("user", params.username);
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
  } catch (cause) {
    throw new LastfmProviderApiError("Last.fm request failed", { cause });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new LastfmProviderApiError("Last.fm response was not valid JSON", {
      httpStatus: response.status,
      cause,
    });
  }

  if (!response.ok) {
    return {
      ok: false,
      kind: "api_error",
      message: `Last.fm HTTP ${response.status}`,
      httpStatus: response.status,
    };
  }

  if (isLastfmErrorBody(body)) {
    if (body.error === LASTFM_ERROR_USER_NOT_FOUND) {
      return {
        ok: false,
        kind: "invalid_username",
        message: body.message,
      };
    }
    return {
      ok: false,
      kind: "api_error",
      message: body.message,
      httpStatus: response.status,
      lastfmError: body.error,
    };
  }

  if (!isRecord(body) || !("user" in body)) {
    return {
      ok: false,
      kind: "api_error",
      message: "Last.fm user.getinfo response missing user payload",
      httpStatus: response.status,
    };
  }

  const userPayload = body as LastfmUserGetInfoOk;
  if (userPayload.user === undefined) {
    return {
      ok: false,
      kind: "api_error",
      message: "Last.fm user.getinfo response missing user payload",
      httpStatus: response.status,
    };
  }

  return { ok: true };
}
