import { describe, expect, it } from "vitest";
import {
  LastfmProviderApiError,
  LastfmProviderValidationError,
  LastfmUsernameNotFoundError,
} from "@vs/lastfm-provider";
import {
  isTransientLastfmImportError,
  isTransientPgError,
  withRetryBackoff,
} from "./importBackoff.js";

describe("importBackoff", () => {
  it("treats common HTTP failures on Last.fm as transient", () => {
    expect(
      isTransientLastfmImportError(
        new LastfmProviderApiError("x", { httpStatus: 503 }),
      ),
    ).toBe(true);
    expect(
      isTransientLastfmImportError(
        new LastfmProviderApiError("x", { httpStatus: 403 }),
      ),
    ).toBe(false);
  });

  it("never treats username and validation failures as transient", () => {
    expect(
      isTransientLastfmImportError(new LastfmUsernameNotFoundError("nope")),
    ).toBe(false);
    expect(
      isTransientLastfmImportError(new LastfmProviderValidationError("bad")),
    ).toBe(false);
  });

  it("uses Error.cause errno codes for LastfmProviderApiError without httpStatus", () => {
    const err = new LastfmProviderApiError("upstream", {
      cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    });
    expect(err.httpStatus).toBeUndefined();
    expect(isTransientLastfmImportError(err)).toBe(true);
  });

  it("does not treat vague error text as transient without errno metadata", () => {
    expect(isTransientLastfmImportError(new Error("ETIMEDOUT in prose"))).toBe(
      false,
    );
  });

  it("treats scrobbles exhausted retries as one more worker-level retry round", () => {
    expect(
      isTransientLastfmImportError(new Error("Failed too many times")),
    ).toBe(true);
  });

  it("detects transient pg error codes", () => {
    expect(isTransientPgError({ code: "57P01" })).toBe(true);
    expect(isTransientPgError({ code: "23505" })).toBe(false);
  });

  it("retries until success", async () => {
    let n = 0;
    const out = await withRetryBackoff(
      async () => {
        n += 1;
        if (n < 3) {
          throw Object.assign(new Error("deadlock"), { code: "40P01" });
        }
        return 7;
      },
      { isRetryable: isTransientPgError, baseMs: 1, maxAttempts: 5 },
    );
    expect(out).toBe(7);
    expect(n).toBe(3);
  });
});
