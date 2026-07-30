import { z } from "zod";

function trimToUndefined(v: unknown): unknown {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== "string") {
    return v;
  }
  const t = v.trim();
  return t === "" ? undefined : t;
}

/**
 * Abuse-limit and JSON body caps shared by Next.js middleware (Edge) and route handlers (Node).
 * This module must not import Node-only APIs so middleware can import `@vs/env/abuse-env-fields`.
 */
function intWithDefault(min: number, max: number, defaultVal: number, label: string) {
  return z
    .preprocess(
      trimToUndefined,
      z.union([
        z.undefined(),
        z.coerce
          .number()
          .int()
          .min(min, `${label} must be at least ${min}`)
          .max(max, `${label} must be at most ${max}`),
      ]),
    )
    .transform((v) => (v === undefined ? defaultVal : v));
}

export const abuseEnvFieldsSchema = z.object({
  /** Login, signup, logout JSON bodies (bytes). */
  VS_API_JSON_BODY_MAX_AUTH_BYTES: intWithDefault(
    1024,
    131_072,
    8192,
    "VS_API_JSON_BODY_MAX_AUTH_BYTES",
  ),
  /** Account-sensitive JSON: `/api/me` PATCH, step-up, purge listen data. */
  VS_API_JSON_BODY_MAX_ACCOUNT_BYTES: intWithDefault(
    2048,
    262_144,
    32_768,
    "VS_API_JSON_BODY_MAX_ACCOUNT_BYTES",
  ),
  /** Import enqueue and export enqueue JSON bodies. */
  VS_API_JSON_BODY_MAX_IMPORT_EXPORT_BYTES: intWithDefault(
    2048,
    262_144,
    32_768,
    "VS_API_JSON_BODY_MAX_IMPORT_EXPORT_BYTES",
  ),
  VS_API_RATE_LIMIT_AUTH_MAX: intWithDefault(1, 10_000, 15, "VS_API_RATE_LIMIT_AUTH_MAX"),
  VS_API_RATE_LIMIT_AUTH_WINDOW_MS: intWithDefault(
    1000,
    3_600_000,
    60_000,
    "VS_API_RATE_LIMIT_AUTH_WINDOW_MS",
  ),
  /**
   * Shared fixed window for routes that enqueue outbound account email (signup verification,
   * resend verification, password reset request, email-change verification). Per-IP in middleware.
   */
  VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX: intWithDefault(
    1,
    10_000,
    8,
    "VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX",
  ),
  VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS: intWithDefault(
    1000,
    3_600_000,
    900_000,
    "VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS",
  ),
  VS_API_RATE_LIMIT_SENSITIVE_POST_MAX: intWithDefault(
    1,
    10_000,
    30,
    "VS_API_RATE_LIMIT_SENSITIVE_POST_MAX",
  ),
  VS_API_RATE_LIMIT_SENSITIVE_POST_WINDOW_MS: intWithDefault(
    1000,
    3_600_000,
    60_000,
    "VS_API_RATE_LIMIT_SENSITIVE_POST_WINDOW_MS",
  ),
  VS_API_RATE_LIMIT_DESTRUCTIVE_MAX: intWithDefault(
    1,
    1000,
    8,
    "VS_API_RATE_LIMIT_DESTRUCTIVE_MAX",
  ),
  VS_API_RATE_LIMIT_DESTRUCTIVE_WINDOW_MS: intWithDefault(
    10_000,
    86_400_000,
    900_000,
    "VS_API_RATE_LIMIT_DESTRUCTIVE_WINDOW_MS",
  ),
  VS_API_RATE_LIMIT_INTERNAL_MAX: intWithDefault(
    1,
    50_000,
    120,
    "VS_API_RATE_LIMIT_INTERNAL_MAX",
  ),
  VS_API_RATE_LIMIT_INTERNAL_WINDOW_MS: intWithDefault(
    1000,
    3_600_000,
    60_000,
    "VS_API_RATE_LIMIT_INTERNAL_WINDOW_MS",
  ),
});

export type AbuseEnvFields = z.infer<typeof abuseEnvFieldsSchema>;

const abuseRawPick = [
  "VS_API_JSON_BODY_MAX_AUTH_BYTES",
  "VS_API_JSON_BODY_MAX_ACCOUNT_BYTES",
  "VS_API_JSON_BODY_MAX_IMPORT_EXPORT_BYTES",
  "VS_API_RATE_LIMIT_AUTH_MAX",
  "VS_API_RATE_LIMIT_AUTH_WINDOW_MS",
  "VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX",
  "VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS",
  "VS_API_RATE_LIMIT_SENSITIVE_POST_MAX",
  "VS_API_RATE_LIMIT_SENSITIVE_POST_WINDOW_MS",
  "VS_API_RATE_LIMIT_DESTRUCTIVE_MAX",
  "VS_API_RATE_LIMIT_DESTRUCTIVE_WINDOW_MS",
  "VS_API_RATE_LIMIT_INTERNAL_MAX",
  "VS_API_RATE_LIMIT_INTERNAL_WINDOW_MS",
] as const;

export function pickAbuseEnvRaw(
  raw: Record<string, string | undefined>,
): Record<(typeof abuseRawPick)[number], string | undefined> {
  const out = {} as Record<(typeof abuseRawPick)[number], string | undefined>;
  for (const k of abuseRawPick) {
    out[k] = raw[k];
  }
  return out;
}

export function parseAbuseEnvFields(
  raw: Record<string, string | undefined>,
): AbuseEnvFields {
  return abuseEnvFieldsSchema.parse(pickAbuseEnvRaw(raw));
}

/** Parsed defaults (unset env); safe for tests and documentation. */
export const defaultAbuseEnvFields: AbuseEnvFields = abuseEnvFieldsSchema.parse({});
