import os from "node:os";
import path from "node:path";
import {
  EXPORT_ARTIFACT_RETENTION_SEC_DEFAULT,
  LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC_DEFAULT,
  LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC_DEFAULT,
  LAYER1_RECONCILE_USERS_PER_TICK_DEFAULT,
  LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT,
  LISTEN_SYNC_USER_MIN_INTERVAL_SEC_DEFAULT,
} from "@vs/domain";
import { parseFeatureFlagsFromEnv } from "@vs/feature-flags";
import { z } from "zod";
import { abuseEnvFieldsSchema } from "./abuse-env-fields.js";
import { isStrictDeployEnv, resolveDeployEnv, type DeployEnv } from "./deploy-env.js";

function refinePostgresDatabaseUrl(value: string, ctx: z.RefinementCtx): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "DATABASE_URL must be a valid URL",
    });
    return;
  }

  if (!parsed.hostname) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "DATABASE_URL must include a host",
    });
    return;
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "DATABASE_URL must include a database name in the path",
    });
  }
}

function refineMailgunFromAddress(value: string, ctx: z.RefinementCtx): void {
  const path: (string | number)[] = ["MAILGUN_FROM"];
  const angle = value.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : value).trim();
  if (!candidate.includes("@")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MAILGUN_FROM must be a bare email or use the \"Name <email@domain>\" format.",
      path,
    });
    return;
  }
  const parsed = z.string().email().safeParse(candidate);
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MAILGUN_FROM must contain a valid email address.",
      path,
    });
  }
}

function refineSecretsEncryptionKey(value: string, ctx: z.RefinementCtx): void {
  const path: (string | number)[] = ["VS_SECRETS_ENCRYPTION_KEY"];
  const trimmed = value.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === 64) {
    key = Buffer.from(trimmed, "hex");
  } else {
    try {
      key = Buffer.from(trimmed, "base64url");
    } catch {
      key = null;
    }
    if (!key || key.length !== 32) {
      try {
        key = Buffer.from(trimmed, "base64");
      } catch {
        key = null;
      }
    }
  }
  if (!key || key.length !== 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "VS_SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64, base64url, or hex)",
      path,
    });
  }
}

function refineMailgunDomain(value: string, ctx: z.RefinementCtx): void {
  const path: (string | number)[] = ["MAILGUN_DOMAIN"];
  const t = value.trim();
  if (t.length < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MAILGUN_DOMAIN is too short to be a valid Mailgun domain.",
      path,
    });
    return;
  }
  if (/\s/.test(t) || t.includes("/")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "MAILGUN_DOMAIN must not contain whitespace or slashes.",
      path,
    });
  }
}

const emailOutboundTransportSchema = z.enum(["mailgun", "capture", "noop"]);
export type EmailOutboundTransport = z.infer<typeof emailOutboundTransportSchema>;

function resolveEmailOutboundTransportFromRaw(data: {
  VS_EMAIL_ENABLED?: "true" | "false";
  VS_EMAIL_TRANSPORT?: EmailOutboundTransport;
  NODE_ENV: string;
  VS_DEPLOY_ENV?: DeployEnv;
}): EmailOutboundTransport | null {
  if (data.VS_EMAIL_ENABLED !== "true") {
    return null;
  }
  const deploy = resolveDeployEnv(data);
  const strict = isStrictDeployEnv(deploy);
  const raw = data.VS_EMAIL_TRANSPORT;
  return raw ?? (strict ? "mailgun" : "capture");
}

function refineRedisUrl(value: string, ctx: z.RefinementCtx): void {
  const path: (string | number)[] = ["REDIS_URL"];
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "REDIS_URL must be a valid URL",
      path,
    });
    return;
  }

  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "REDIS_URL must use redis:// or rediss://",
      path,
    });
    return;
  }

  if (!parsed.hostname) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "REDIS_URL must include a host",
      path,
    });
  }
}

/**
 * Server-side environment contract shared by the Next.js server and the worker.
 * Client bundles must not import this module.
 */
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

const serverEnvObjectSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  /**
   * Deployment tier for secret and safety rules (`development`, `staging`, `production`, `test`).
   * When unset, inferred from `NODE_ENV` (non-development, non-test Node environments map to `production`).
   */
  VS_DEPLOY_ENV: z.preprocess(
    trimToUndefined,
    z.enum(["development", "staging", "production", "test"]).optional(),
  ),
  /** Local-only seed password (`npm run seed:local`). Must not be set in staging or production. */
  VS_LOCAL_SEED_PASSWORD: z.preprocess(trimToUndefined, z.string().optional()),
  /**
   * Public WebSocket URL for listen realtime (browser). Optional; server falls back to `LISTEN_REALTIME_WS_URL`
   * or localhost when unset.
   */
  NEXT_PUBLIC_LISTEN_REALTIME_WS_URL: z.preprocess(
    trimToUndefined,
    z.string().min(1).optional(),
  ),
  /** When set (non-empty), the worker can call Last.fm for queued imports. */
  LASTFM_API_KEY: z.preprocess((v) => {
    if (v === undefined || v === null) {
      return undefined;
    }
    if (typeof v !== "string") {
      return v;
    }
    const t = v.trim();
    return t === "" ? undefined : t;
  }, z.string().min(1, "LASTFM_API_KEY must be non-empty when set").optional()),
  /**
   * Optional 32-byte AES-256-GCM key (base64, base64url, or hex) for encrypting
   * per-user secrets at rest (e.g. `users.lastfm_api_key`). When unset, values are
   * stored plaintext (fine for local single-user; set this for any durable deploy).
   */
  VS_SECRETS_ENCRYPTION_KEY: z.preprocess(trimToUndefined, z.string().optional()),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a postgres:// or postgresql:// URL",
    )
    .superRefine(refinePostgresDatabaseUrl),
  /**
   * BullMQ / ioredis connection string (shared by API, worker, and scripts).
   * Optional when `FEATURE_FLAGS.skipRedisQueues` is true (Postgres-only local dev).
   */
  REDIS_URL: z.preprocess((v) => {
    if (v === undefined || v === null) {
      return undefined;
    }
    if (typeof v !== "string") {
      return v;
    }
    const t = v.trim();
    return t === "" ? undefined : t;
  }, z.string().optional()),
  /**
   * Absolute directory where the worker writes completed listen-export ZIPs and the
   * Next.js API reads them for download. In `development` or `test`, when unset, defaults under the OS
   * temp directory. In `staging` and `production`, must be set to a non-empty path (no temp default).
   */
  EXPORT_ARTIFACTS_DIR: z.preprocess(trimToUndefined, z.string().optional()),
  /**
   * Wall-clock seconds a completed listen-export ZIP remains downloadable before the
   * worker marks the job `expired` and deletes the file. Bounded to avoid misconfiguration.
   */
  EXPORT_ARTIFACT_RETENTION_SEC: z.coerce
    .number()
    .int()
    .min(300, "EXPORT_ARTIFACT_RETENTION_SEC must be at least 300")
    .max(366 * 86_400, "EXPORT_ARTIFACT_RETENTION_SEC must be at most 366 days")
    .default(EXPORT_ARTIFACT_RETENTION_SEC_DEFAULT),
  /**
   * Maximum export rows the worker expires per cleanup sweep (disk unlink follows in-process).
   */
  EXPORT_ARTIFACT_CLEANUP_BATCH: z.coerce
    .number()
    .int()
    .min(1, "EXPORT_ARTIFACT_CLEANUP_BATCH must be at least 1")
    .max(500, "EXPORT_ARTIFACT_CLEANUP_BATCH must be at most 500")
    .default(100),
  /**
   * Minimum wall time between enqueueing background listen-sync jobs for the same user.
   * Worker-only; parsed as integer seconds (30–86400), default from domain.
   */
  LISTEN_SYNC_USER_MIN_INTERVAL_SEC: z.coerce
    .number()
    .int()
    .min(30, "LISTEN_SYNC_USER_MIN_INTERVAL_SEC must be at least 30")
    .max(86_400, "LISTEN_SYNC_USER_MIN_INTERVAL_SEC must be at most 86400")
    .default(LISTEN_SYNC_USER_MIN_INTERVAL_SEC_DEFAULT),
  /**
   * Minimum seconds between Layer 1 Advanced reconciliation sweeps on the worker (VS-83).
   * Lower in staging to exercise the path; production defaults to 24h.
   */
  LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC: z.coerce
    .number()
    .int()
    .min(60, "LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC must be at least 60")
    .max(168 * 86_400, "LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC must be at most 7 days")
    .default(LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC_DEFAULT),
  /**
   * Max Advanced users considered for enqueue per sweep after DB selection (bounded work).
   */
  LAYER1_RECONCILE_USERS_PER_TICK: z.coerce
    .number()
    .int()
    .min(1, "LAYER1_RECONCILE_USERS_PER_TICK must be at least 1")
    .max(2_000, "LAYER1_RECONCILE_USERS_PER_TICK must be at most 2000")
    .default(LAYER1_RECONCILE_USERS_PER_TICK_DEFAULT),
  /**
   * Seconds after `last_failed_at` before scheduled reconciliation retries a failed Layer 1 row.
   */
  LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC: z.coerce
    .number()
    .int()
    .min(60, "LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC must be at least 60")
    .max(168 * 86_400, "LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC must be at most 7 days")
    .default(LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC_DEFAULT),
  /**
   * VS-84 — after this many consecutive persisted failures, per-user state becomes
   * `failed_exhausted` and routine enqueue reasons stop scheduling work until an operator
   * or internal reset path runs.
   */
  LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES: z.coerce
    .number()
    .int()
    .min(1, "LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES must be at least 1")
    .max(100, "LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES must be at most 100")
    .default(LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT),
  /**
   * Shared secret for short-lived listen WebSocket auth tokens (HMAC).
   * When unset, Next.js omits realtime handoff and the dashboard keeps HTTP polling only.
   */
  REALTIME_JWT_SECRET: z.preprocess(trimToUndefined, z.string().optional()),
  /**
   * When `"true"`, strict deploys require a strong `REALTIME_JWT_SECRET`.
   * When `"false"`, strict deploys do not require realtime signing material (HTTP polling only).
   * When unset, a non-empty `REALTIME_JWT_SECRET` still implies realtime is in use and must meet strict length rules.
   */
  LISTEN_REALTIME_ENABLED: z.preprocess(trimToUndefined, z.enum(["true", "false"]).optional()),
  /** TCP port for the standalone `realtime` WebSocket + NOTIFY bridge. */
  LISTEN_REALTIME_PORT: z.coerce
    .number()
    .int()
    .min(1, "LISTEN_REALTIME_PORT must be at least 1")
    .max(65_535, "LISTEN_REALTIME_PORT must be at most 65535")
    .default(3457),
  /**
   * Browser WebSocket URL for listen updates (e.g. ws://127.0.0.1:3457).
   * Optional; when unset the token route falls back to ws://127.0.0.1:${LISTEN_REALTIME_PORT}.
   */
  LISTEN_REALTIME_WS_URL: z.preprocess((v) => {
    if (v === undefined || v === null) {
      return undefined;
    }
    if (typeof v !== "string") {
      return v;
    }
    const t = v.trim();
    return t === "" ? undefined : t;
  }, z.string().min(1, "LISTEN_REALTIME_WS_URL must be non-empty when set").optional()),
  /**
   * JSON object of booleans; keys must be registered in `packages/feature-flags/src/keys.ts`.
   * Omitted or `{}` means every registered flag is false.
   */
  FEATURE_FLAGS: z.preprocess((v) => {
    if (v === undefined || v === null) {
      return undefined;
    }
    if (typeof v !== "string") {
      return v;
    }
    const t = v.trim();
    return t === "" ? undefined : t;
  }, z.string().optional()).transform((raw) => parseFeatureFlagsFromEnv(raw)),
  /**
   * BullMQ `Worker` concurrency per canonical VS queue (worker process only).
   * Bounded to reduce accidental overload; raise caps only with capacity planning.
   */
  BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST: z.coerce
    .number()
    .int()
    .min(1, "BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST must be at least 1")
    .max(64, "BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST must be at most 64")
    .default(1),
  BULLMQ_WORKER_CONCURRENCY_IMPORTS: z.coerce
    .number()
    .int()
    .min(1, "BULLMQ_WORKER_CONCURRENCY_IMPORTS must be at least 1")
    .max(64, "BULLMQ_WORKER_CONCURRENCY_IMPORTS must be at most 64")
    .default(2),
  BULLMQ_WORKER_CONCURRENCY_EXPORTS: z.coerce
    .number()
    .int()
    .min(1, "BULLMQ_WORKER_CONCURRENCY_EXPORTS must be at least 1")
    .max(64, "BULLMQ_WORKER_CONCURRENCY_EXPORTS must be at most 64")
    .default(1),
  BULLMQ_WORKER_CONCURRENCY_ANALYTICS: z.coerce
    .number()
    .int()
    .min(1, "BULLMQ_WORKER_CONCURRENCY_ANALYTICS must be at least 1")
    .max(64, "BULLMQ_WORKER_CONCURRENCY_ANALYTICS must be at most 64")
    .default(1),
  BULLMQ_WORKER_CONCURRENCY_SYNC: z.coerce
    .number()
    .int()
    .min(1, "BULLMQ_WORKER_CONCURRENCY_SYNC must be at least 1")
    .max(64, "BULLMQ_WORKER_CONCURRENCY_SYNC must be at most 64")
    .default(2),
  BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC: z.coerce
    .number()
    .int()
    .min(1, "BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC must be at least 1")
    .max(64, "BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC must be at most 64")
    .default(2),
  /**
   * Minimum wall time between consecutive Last.fm page fetches within one import job,
   * after `IMPORT_LASTFM_PAGE_BURST` pages. Worker-only; set to 0 to disable (tests).
   */
  IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(0, "IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS must be at least 0")
    .max(120_000, "IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS must be at most 120000")
    .default(200),
  /**
   * Number of Last.fm pages per job that may run back-to-back before the minimum
   * interval applies (absorbs short bursts without delaying the first pages).
   */
  IMPORT_LASTFM_PAGE_BURST: z.coerce
    .number()
    .int()
    .min(1, "IMPORT_LASTFM_PAGE_BURST must be at least 1")
    .max(100, "IMPORT_LASTFM_PAGE_BURST must be at most 100")
    .default(3),
  /**
   * Max pending raw scrobbles canonicalized in one DB transaction. Smaller values
   * smooth CPU/lock pressure during large Last.fm imports.
   */
  IMPORT_CANONICALIZATION_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(25, "IMPORT_CANONICALIZATION_BATCH_SIZE must be at least 25")
    .max(500, "IMPORT_CANONICALIZATION_BATCH_SIZE must be at most 500")
    .default(200),
  /**
   * Number of canonicalization batches to run after each persisted Last.fm page.
   * The worker drains the remainder at the end; this setting prevents one large
   * end-of-import CPU spike.
   */
  IMPORT_CANONICALIZATION_BATCHES_PER_PAGE: z.coerce
    .number()
    .int()
    .min(0, "IMPORT_CANONICALIZATION_BATCHES_PER_PAGE must be at least 0")
    .max(10, "IMPORT_CANONICALIZATION_BATCHES_PER_PAGE must be at most 10")
    .default(1),
  /**
   * Optional per-bucket job sample cap for `inspect-bullmq-queues` (0–500).
   * When unset, the queue package default applies.
   */
  VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT: z.coerce
    .number()
    .int()
    .min(0, "VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT must be at least 0")
    .max(500, "VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT must be at most 500")
    .optional(),
  /**
   * Stale-running job probe window for `inspect-stalled-db-jobs` (seconds, 1–86400).
   * When unset, the script uses its documented default (600).
   */
  VS_STALLED_JOB_PROBE_SECONDS: z.coerce
    .number()
    .int()
    .min(1, "VS_STALLED_JOB_PROBE_SECONDS must be at least 1")
    .max(86_400, "VS_STALLED_JOB_PROBE_SECONDS must be at most 86400")
    .optional(),
  /**
   * Bearer secret for HTTP routes under `/api/internal/*` (maintenance and operator tooling).
   * When unset, internal routes respond with `503` and `code: internal_api_disabled`.
   * In staging and production, when set, must be at least 32 characters.
   */
  VS_INTERNAL_API_SECRET: z.preprocess(trimToUndefined, z.string().optional()),
  /**
   * When `"true"`, the app may interpret `x-forwarded-for`, `x-forwarded-proto`, and `x-forwarded-host`
   * for rate limiting and HTTPS detection. Staging/production require an explicit `"true"` or `"false"`;
   * choose `"true"` only when the ingress overwrites or strips untrusted forwarded headers.
   */
  VS_TRUST_PROXY_HEADERS: z.preprocess(
    trimToUndefined,
    z.enum(["true", "false"]).optional(),
  ),
  /**
   * Canonical browser-facing origin (`https://…`, no path required). Required in strict deploy tiers
   * for Host/Origin checks on auth-sensitive HTTP routes and HTTPS upgrade redirects at the edge.
   */
  VS_PUBLIC_APP_ORIGIN: z.preprocess(trimToUndefined, z.string().optional()),
  /**
   * Next.js app base URL for server-to-server calls from the worker (e.g. `http://127.0.0.1:3000`).
   * When unset, `VS_PUBLIC_APP_ORIGIN` is used for read-cache invalidation POSTs. When both are
   * unset, the worker skips HTTP invalidation (TTL remains the staleness bound on each instance).
   */
  VS_WEB_INTERNAL_ORIGIN: z.preprocess(trimToUndefined, z.string().url().optional()),
  /**
   * When `"true"`, outbound email flows are enabled (transport defaults by deploy tier; see `VS_EMAIL_TRANSPORT`).
   * When unset or `"false"`, Mailgun variables must not be set (avoids accidental partial configuration).
   */
  VS_EMAIL_ENABLED: z.preprocess(trimToUndefined, z.enum(["true", "false"]).optional()),
  /**
   * When `VS_EMAIL_ENABLED=true`, selects how messages leave the process.
   * `mailgun`: real HTTP to Mailgun (default in staging/production; in development/test requires
   * `VS_EMAIL_ALLOW_UNSAFE_MAILGUN=true`). `capture`: structured logs plus an in-memory buffer (default
   * in development/test when unset). `noop`: succeed without network or capture (fast automated tests).
   */
  VS_EMAIL_TRANSPORT: z.preprocess(trimToUndefined, emailOutboundTransportSchema.optional()),
  /**
   * Development and test only. Set to `"true"` to allow `VS_EMAIL_TRANSPORT=mailgun` outside strict deploy tiers.
   * Must not be set in staging or production.
   */
  VS_EMAIL_ALLOW_UNSAFE_MAILGUN: z.preprocess(trimToUndefined, z.enum(["true", "false"]).optional()),
  /**
   * Optional welcome email after signup and/or first successful email verification.
   * `off` (default): never send. `signup`: after signup transaction commits.
   * `email_verified`: after first successful verification consume.
   * Requires `VS_EMAIL_ENABLED=true`, a non-null outbound mailer (`capture`, `noop`, or `mailgun` transport), and `VS_PUBLIC_APP_ORIGIN`.
   */
  VS_WELCOME_EMAIL: z.preprocess(
    trimToUndefined,
    z.enum(["off", "signup", "email_verified"]).optional(),
  ),
  /** Mailgun private API key (required when outbound transport is `mailgun`). */
  MAILGUN_API_KEY: z.preprocess(trimToUndefined, z.string().optional()),
  /** Verified Mailgun sending domain (required when outbound transport is `mailgun`). */
  MAILGUN_DOMAIN: z.preprocess(trimToUndefined, z.string().optional()),
  /**
   * RFC5322 From for Mailgun (bare `user@domain` or `Display Name <user@domain>`).
   * Required when outbound transport is `mailgun`.
   */
  MAILGUN_FROM: z.preprocess(trimToUndefined, z.string().optional()),
  /** Mailgun API region (defaults to us when email is enabled). */
  MAILGUN_REGION: z.preprocess(trimToUndefined, z.enum(["us", "eu"]).optional()),
}).merge(abuseEnvFieldsSchema);

const serverEnvSchemaWithRedisRules = serverEnvObjectSchema.superRefine(
  (data, ctx) => {
    const deploy = resolveDeployEnv(data);
    const strict = isStrictDeployEnv(deploy);

    if (strict) {
      if (!data.EXPORT_ARTIFACTS_DIR || data.EXPORT_ARTIFACTS_DIR.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "EXPORT_ARTIFACTS_DIR is required in staging and production (no temp-directory default).",
          path: ["EXPORT_ARTIFACTS_DIR"],
        });
      }
      if (data.FEATURE_FLAGS.skipRedisQueues === true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "FEATURE_FLAGS.skipRedisQueues is not allowed in staging or production; configure REDIS_URL.",
          path: ["FEATURE_FLAGS"],
        });
      }
      const rt = data.REALTIME_JWT_SECRET;
      const rtLen = rt?.length ?? 0;
      const listenFlag = data.LISTEN_REALTIME_ENABLED;
      const secretPresent = rtLen > 0;
      const mustHaveStrongRealtimeSecret =
        listenFlag === "true" ||
        (listenFlag !== "false" && secretPresent);
      if (mustHaveStrongRealtimeSecret) {
        if (!rt || rtLen < 32) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "REALTIME_JWT_SECRET must be at least 32 characters when listen realtime is enabled for this deploy (LISTEN_REALTIME_ENABLED=true, or secret set without LISTEN_REALTIME_ENABLED=false).",
            path: ["REALTIME_JWT_SECRET"],
          });
        }
      } else if (secretPresent && rtLen < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "REALTIME_JWT_SECRET is set but shorter than 32 characters; remove it or set LISTEN_REALTIME_ENABLED=true with a strong secret.",
          path: ["REALTIME_JWT_SECRET"],
        });
      }
      if (deploy === "production") {
        const redisUrl = data.REDIS_URL;
        if (redisUrl !== undefined && redisUrl.length > 0 && !redisUrl.startsWith("rediss://")) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "REDIS_URL must use rediss:// in production (TLS). Staging may use redis:// when appropriate.",
            path: ["REDIS_URL"],
          });
        }
      }
      if (data.VS_LOCAL_SEED_PASSWORD !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "VS_LOCAL_SEED_PASSWORD must not be set in staging or production.",
          path: ["VS_LOCAL_SEED_PASSWORD"],
        });
      }
      const internalSecret = data.VS_INTERNAL_API_SECRET;
      if (
        internalSecret !== undefined &&
        internalSecret.length > 0 &&
        internalSecret.length < 32
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "VS_INTERNAL_API_SECRET must be at least 32 characters when set in staging or production.",
          path: ["VS_INTERNAL_API_SECRET"],
        });
      }
      if (data.VS_TRUST_PROXY_HEADERS === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "VS_TRUST_PROXY_HEADERS must be set to \"true\" or \"false\" in staging and production (explicit reverse-proxy trust decision).",
          path: ["VS_TRUST_PROXY_HEADERS"],
        });
      }
      const pubRaw = data.VS_PUBLIC_APP_ORIGIN?.trim();
      if (!pubRaw) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "VS_PUBLIC_APP_ORIGIN is required in staging and production (canonical https origin, e.g. https://app.example.com).",
          path: ["VS_PUBLIC_APP_ORIGIN"],
        });
      } else {
        let parsed: URL | undefined;
        try {
          parsed = new URL(pubRaw);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "VS_PUBLIC_APP_ORIGIN must be a valid absolute URL.",
            path: ["VS_PUBLIC_APP_ORIGIN"],
          });
        }
        if (parsed && parsed.protocol !== "https:") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "VS_PUBLIC_APP_ORIGIN must use https:// in staging and production.",
            path: ["VS_PUBLIC_APP_ORIGIN"],
          });
        }
      }
    } else {
      const rt = data.REALTIME_JWT_SECRET;
      if (rt !== undefined && rt.length > 0 && rt.length < 16) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "REALTIME_JWT_SECRET must be at least 16 characters when set (development and test).",
          path: ["REALTIME_JWT_SECRET"],
        });
      }
      const internalSecret = data.VS_INTERNAL_API_SECRET;
      if (
        internalSecret !== undefined &&
        internalSecret.length > 0 &&
        internalSecret.length < 16
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "VS_INTERNAL_API_SECRET must be at least 16 characters when set (development and test).",
          path: ["VS_INTERNAL_API_SECRET"],
        });
      }
    }

    if (data.VS_SECRETS_ENCRYPTION_KEY !== undefined) {
      refineSecretsEncryptionKey(data.VS_SECRETS_ENCRYPTION_KEY, ctx);
    }

    const skip = data.FEATURE_FLAGS.skipRedisQueues === true;
    const redis = data.REDIS_URL;
    if (!skip) {
      if (redis === undefined || redis.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "REDIS_URL is required unless FEATURE_FLAGS includes \"skipRedisQueues\":true (Postgres-only local dev).",
          path: ["REDIS_URL"],
        });
      } else {
        refineRedisUrl(redis, ctx);
      }
    } else if (redis !== undefined && redis.length > 0) {
      refineRedisUrl(redis, ctx);
    }

    const optionalOrigin = data.VS_PUBLIC_APP_ORIGIN?.trim();
    if (optionalOrigin) {
      try {
        new URL(optionalOrigin);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "VS_PUBLIC_APP_ORIGIN must be a valid absolute URL when set.",
          path: ["VS_PUBLIC_APP_ORIGIN"],
        });
      }
    }

    const emailEnabled = data.VS_EMAIL_ENABLED === "true";
    const mailgunKey = data.MAILGUN_API_KEY?.trim() ?? "";
    const mailgunDomain = data.MAILGUN_DOMAIN?.trim() ?? "";
    const mailgunFrom = data.MAILGUN_FROM?.trim() ?? "";
    const mailgunRegionTouched = data.MAILGUN_REGION !== undefined;
    const anyMailgun =
      mailgunKey.length > 0 ||
      mailgunDomain.length > 0 ||
      mailgunFrom.length > 0 ||
      mailgunRegionTouched;

    const effectiveTransport = resolveEmailOutboundTransportFromRaw(data);

    if (data.VS_EMAIL_TRANSPORT !== undefined && !emailEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'VS_EMAIL_TRANSPORT is set but VS_EMAIL_ENABLED is not "true"; remove VS_EMAIL_TRANSPORT or enable outbound email explicitly.',
        path: ["VS_EMAIL_TRANSPORT"],
      });
    }
    if (data.VS_EMAIL_ALLOW_UNSAFE_MAILGUN !== undefined && !emailEnabled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'VS_EMAIL_ALLOW_UNSAFE_MAILGUN is set but VS_EMAIL_ENABLED is not "true"; remove it when outbound email is disabled.',
        path: ["VS_EMAIL_ALLOW_UNSAFE_MAILGUN"],
      });
    }

    const allowUnsafeMailgun = data.VS_EMAIL_ALLOW_UNSAFE_MAILGUN === "true";
    if (allowUnsafeMailgun && strict) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "VS_EMAIL_ALLOW_UNSAFE_MAILGUN applies only to development and test deploy tiers; remove it for staging and production.",
        path: ["VS_EMAIL_ALLOW_UNSAFE_MAILGUN"],
      });
    }

    if (emailEnabled && effectiveTransport === "mailgun" && !strict && !allowUnsafeMailgun) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Real Mailgun HTTP delivery in development or test requires VS_EMAIL_ALLOW_UNSAFE_MAILGUN="true" (explicit opt-in). Otherwise omit VS_EMAIL_TRANSPORT (defaults to capture) or set VS_EMAIL_TRANSPORT=noop.',
        path: ["VS_EMAIL_TRANSPORT"],
      });
    }

    if (emailEnabled && strict && effectiveTransport !== "mailgun") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Staging and production require real Mailgun delivery; use VS_EMAIL_TRANSPORT=mailgun or omit VS_EMAIL_TRANSPORT (mailgun is the default in strict tiers).",
        path: ["VS_EMAIL_TRANSPORT"],
      });
    }

    const needsFullMailgun = emailEnabled && effectiveTransport === "mailgun";
    const simOutbound = emailEnabled && !needsFullMailgun;

    if (needsFullMailgun) {
      if (!mailgunKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "MAILGUN_API_KEY is required when VS_EMAIL_ENABLED=true and VS_EMAIL_TRANSPORT is mailgun (or defaulted to mailgun in a strict deploy tier).",
          path: ["MAILGUN_API_KEY"],
        });
      } else if (mailgunKey.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "MAILGUN_API_KEY looks invalid (too short). Use the private API key from the Mailgun dashboard.",
          path: ["MAILGUN_API_KEY"],
        });
      }
      if (!mailgunDomain) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "MAILGUN_DOMAIN is required when VS_EMAIL_ENABLED=true and outbound transport is mailgun.",
          path: ["MAILGUN_DOMAIN"],
        });
      } else {
        refineMailgunDomain(mailgunDomain, ctx);
      }
      if (!mailgunFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "MAILGUN_FROM is required when VS_EMAIL_ENABLED=true and outbound transport is mailgun.",
          path: ["MAILGUN_FROM"],
        });
      } else {
        refineMailgunFromAddress(mailgunFrom, ctx);
      }
    } else if (simOutbound && anyMailgun) {
      const hasAllStrings =
        mailgunKey.length > 0 && mailgunDomain.length > 0 && mailgunFrom.length > 0;
      if (!hasAllStrings) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "When VS_EMAIL_TRANSPORT is capture or noop, either omit all MAILGUN_* variables or provide MAILGUN_API_KEY, MAILGUN_DOMAIN, and MAILGUN_FROM together (optional metadata only; messages are not sent to Mailgun).",
          path: ["MAILGUN_API_KEY"],
        });
      } else if (mailgunKey.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "MAILGUN_API_KEY looks invalid (too short). Use the private API key from the Mailgun dashboard.",
          path: ["MAILGUN_API_KEY"],
        });
      } else {
        refineMailgunDomain(mailgunDomain, ctx);
        refineMailgunFromAddress(mailgunFrom, ctx);
      }
    } else if (!emailEnabled && anyMailgun) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Set VS_EMAIL_ENABLED="true" to use Mailgun, or remove MAILGUN_* configuration when outbound email is disabled.',
        path: ["VS_EMAIL_ENABLED"],
      });
    }
  },
);

export const serverEnvSchema = serverEnvSchemaWithRedisRules.transform(
  (data) => {
    const deployEnv = resolveDeployEnv(data);
    const skip = data.FEATURE_FLAGS.skipRedisQueues === true;
    const redis = data.REDIS_URL;
    const exportDir =
      data.EXPORT_ARTIFACTS_DIR !== undefined && data.EXPORT_ARTIFACTS_DIR.length > 0
        ? data.EXPORT_ARTIFACTS_DIR
        : path.join(os.tmpdir(), "vs-export-artifacts");
    const {
      VS_PUBLIC_APP_ORIGIN,
      VS_TRUST_PROXY_HEADERS,
      VS_EMAIL_ENABLED,
      VS_EMAIL_TRANSPORT,
      VS_EMAIL_ALLOW_UNSAFE_MAILGUN,
      VS_WELCOME_EMAIL,
      MAILGUN_API_KEY,
      MAILGUN_DOMAIN,
      MAILGUN_FROM,
      MAILGUN_REGION,
      ...rest
    } = data;
    const publicAppOrigin =
      VS_PUBLIC_APP_ORIGIN !== undefined && VS_PUBLIC_APP_ORIGIN.trim().length > 0
        ? new URL(VS_PUBLIC_APP_ORIGIN.trim()).origin
        : undefined;
    const trustProxyHeaders = VS_TRUST_PROXY_HEADERS === "true";
    const emailOutboundEnabled = VS_EMAIL_ENABLED === "true";
    const emailTransport = resolveEmailOutboundTransportFromRaw(data) ?? undefined;
    const region = MAILGUN_REGION ?? "us";
    const mailgunBaseHost =
      region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
    const mailgunOutbound =
      emailOutboundEnabled &&
      emailTransport === "mailgun" &&
      MAILGUN_API_KEY !== undefined &&
      MAILGUN_API_KEY.trim().length > 0 &&
      MAILGUN_DOMAIN !== undefined &&
      MAILGUN_DOMAIN.trim().length > 0 &&
      MAILGUN_FROM !== undefined &&
      MAILGUN_FROM.trim().length > 0
        ? {
            apiKey: MAILGUN_API_KEY.trim(),
            domain: MAILGUN_DOMAIN.trim(),
            from: MAILGUN_FROM.trim(),
            region,
            messagesUrl: `${mailgunBaseHost}/v3/${encodeURIComponent(MAILGUN_DOMAIN.trim())}/messages`,
          }
        : undefined;
    const welcomeEmailTrigger = VS_WELCOME_EMAIL ?? "off";
    return {
      ...rest,
      deployEnv,
      EXPORT_ARTIFACTS_DIR: exportDir,
      redisQueuesEnabled: !skip,
      REDIS_URL: skip
        ? redis !== undefined && redis.length > 0
          ? redis
          : undefined
        : redis!,
      trustProxyHeaders,
      publicAppOrigin,
      emailOutboundEnabled,
      emailTransport,
      mailgunOutbound,
      welcomeEmailTrigger,
    };
  },
);

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export type MailgunOutboundConfig = NonNullable<ServerEnv["mailgunOutbound"]>;

/**
 * Whether BullMQ producers/workers should use Redis. Treats missing
 * `redisQueuesEnabled` (e.g. partial test mocks) as enabled.
 */
export function isRedisQueuesEnabled(
  env: Pick<ServerEnv, "redisQueuesEnabled">,
): boolean {
  return env.redisQueuesEnabled !== false;
}
