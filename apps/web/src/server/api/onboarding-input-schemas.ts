import { z } from "zod";

const lastfmUsernameSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(1).max(64),
);

const lastfmApiKeySchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z.string().min(8).max(128),
);

export const onboardingLastfmConfigureBodySchema = z
  .object({
    lastfmUsername: lastfmUsernameSchema,
    lastfmApiKey: lastfmApiKeySchema,
  })
  .strict();

/** Optional fields: omitted values are read from the authenticated user row. */
export const onboardingLastfmValidateBodySchema = z
  .object({
    lastfmUsername: lastfmUsernameSchema.optional(),
    lastfmApiKey: lastfmApiKeySchema.optional(),
  })
  .strict();
