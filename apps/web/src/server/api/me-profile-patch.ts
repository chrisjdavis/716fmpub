import { z } from "zod";

import { isValidIanaTimeZone } from "@/server/infer-briefing-time-zone";

/** Trim; empty string becomes `null` (clear profile field). */
function trimToNull(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return value;
  }
  const t = value.trim();
  return t === "" ? null : t;
}

const lastfmApiKeyFieldSchema = z.preprocess(
  (v) => {
    if (v === undefined) {
      return undefined;
    }
    if (v === null) {
      return null;
    }
    if (typeof v === "string") {
      const t = v.trim();
      return t === "" ? null : t;
    }
    return v;
  },
  z.union([z.undefined(), z.null(), z.string().min(8).max(128)]),
);

/**
 * PATCH `/api/me` body: `displayName` and `lastfmUsername` are required so the contract is explicit.
 * `null` or blank string clears those profile fields.
 * Non-null `lastfmUsername` uses the same length bounds as `POST /api/imports` (`lastfmUsername`).
 *
 * `lastfmApiKey` is optional: omit it to leave the stored key unchanged; `null` clears it;
 * a non-empty string replaces the stored key (never echoed on GET).
 */
export const meProfilePatchBodySchema = z
  .object({
    displayName: z.preprocess(
      trimToNull,
      z.union([z.string().max(120), z.null()]),
    ),
    lastfmUsername: z.preprocess(
      trimToNull,
      z.union([z.string().min(1).max(64), z.null()]),
    ),
    lastfmApiKey: lastfmApiKeyFieldSchema.optional(),
    statsTimezone: z
      .preprocess(trimToNull, z.union([z.string().min(1).max(100), z.null()]))
      .optional()
      .refine((v) => v === undefined || v === null || isValidIanaTimeZone(v), {
        message: "statsTimezone must be a valid IANA time zone name",
      }),
  })
  .strict();

export type MeProfilePatchBody = z.infer<typeof meProfilePatchBodySchema>;
