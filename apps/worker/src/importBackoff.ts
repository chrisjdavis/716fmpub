/**
 * Shared backoff and retry classification for the Last.fm import worker.
 *
 * Provider calls use the `scrobbles` client’s internal retries; this module adds
 * bounded backoff when the async iterator is torn down by a **transient** error
 * so we can rebuild pagination from `checkpoint_oldest_uts` without guessing.
 * Transient classification prefers HTTP status and `Error.cause` errno codes over
 * loose message substring matching.
 *
 * **BullMQ vs in-process:** Queue-level exponential backoff and attempts for the
 * `imports` queue live in `@vs/queue` (`defaultImportsJobOptions`); this file
 * classifies errors for **in-run** `withRetryBackoff` / provider rounds only.
 */
import {
  LastfmProviderApiError,
  LastfmProviderValidationError,
  LastfmUsernameNotFoundError,
} from "@vs/lastfm-provider";

/**
 * Wall-clock silence on durable `running` rows (`import_jobs`, `export_jobs`) without
 * a progress/`updated_at` heartbeat before the worker tick treats them as orphaned.
 */
export const DEFAULT_STALE_RUNNING_PIPELINE_SECONDS = 600;

/** @see {@link DEFAULT_STALE_RUNNING_PIPELINE_SECONDS} */
export const DEFAULT_STALE_RUNNING_IMPORT_SECONDS =
  DEFAULT_STALE_RUNNING_PIPELINE_SECONDS;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function isTransientPgError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: string }).code;
  return (
    code === "57P01" ||
    code === "08003" ||
    code === "08006" ||
    code === "40001" ||
    code === "40P01"
  );
}

function isNodeTransientNetworkCode(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const code = (err as { code?: string }).code;
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "EPIPE"
  );
}

/** Walks a shallow `Error.cause` chain for errno-style transient network codes. */
function hasTransientNetworkCause(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur !== undefined && cur !== null; depth += 1) {
    if (isNodeTransientNetworkCode(cur)) {
      return true;
    }
    if (cur instanceof Error && cur.cause !== undefined) {
      cur = cur.cause;
      continue;
    }
    break;
  }
  return false;
}

export function isTransientLastfmImportError(err: unknown): boolean {
  if (err instanceof LastfmUsernameNotFoundError) {
    return false;
  }
  if (err instanceof LastfmProviderValidationError) {
    return false;
  }
  if (err instanceof LastfmProviderApiError) {
    const s = err.httpStatus;
    if (s === 400 || s === 401 || s === 403 || s === 404) {
      return false;
    }
    if (
      s === 429 ||
      s === 408 ||
      s === 500 ||
      s === 502 ||
      s === 503 ||
      s === 504 ||
      s === 520
    ) {
      return true;
    }
    if (s !== undefined) {
      return false;
    }
    return hasTransientNetworkCause(err);
  }
  if (err instanceof Error && err.message === "Failed too many times") {
    return true;
  }
  return hasTransientNetworkCause(err);
}

export async function withRetryBackoff<T>(
  fn: () => Promise<T>,
  input: Readonly<{
    isRetryable: (err: unknown) => boolean;
    maxAttempts?: number;
    baseMs?: number;
    factor?: number;
  }>,
): Promise<T> {
  const maxAttempts = input.maxAttempts ?? 5;
  const baseMs = input.baseMs ?? 200;
  const factor = input.factor ?? 2;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt >= maxAttempts || !input.isRetryable(err)) {
        throw err;
      }
      const delay = baseMs * factor ** (attempt - 1);
      await sleep(Math.min(delay, 30_000));
    }
  }
}
