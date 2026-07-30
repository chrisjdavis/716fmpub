import { ZodError } from "zod";
import { pickAbuseEnvRaw } from "./abuse-env-fields.js";
import type { ServerEnv } from "./schema.js";
import { serverEnvSchema } from "./schema.js";

function formatZodError(error: ZodError): string {
  const flat = error.flatten();
  const lines: string[] = [
    "[env] Server environment validation failed. Fix the following and restart:",
  ];
  for (const [field, messages] of Object.entries(flat.fieldErrors)) {
    if (messages?.length) {
      lines.push(`  - ${field}: ${messages.join("; ")}`);
    }
  }
  for (const msg of flat.formErrors) {
    lines.push(`  - ${msg}`);
  }
  return lines.join("\n");
}

export function parseServerEnv(raw: NodeJS.ProcessEnv): ServerEnv {
  const parsed = serverEnvSchema.safeParse({
    NODE_ENV: raw.NODE_ENV,
    VS_DEPLOY_ENV: raw.VS_DEPLOY_ENV,
    VS_LOCAL_SEED_PASSWORD: raw.VS_LOCAL_SEED_PASSWORD,
    NEXT_PUBLIC_LISTEN_REALTIME_WS_URL: raw.NEXT_PUBLIC_LISTEN_REALTIME_WS_URL,
    DATABASE_URL: raw.DATABASE_URL,
    REDIS_URL: raw.REDIS_URL,
    EXPORT_ARTIFACTS_DIR: raw.EXPORT_ARTIFACTS_DIR,
    EXPORT_ARTIFACT_RETENTION_SEC: raw.EXPORT_ARTIFACT_RETENTION_SEC,
    EXPORT_ARTIFACT_CLEANUP_BATCH: raw.EXPORT_ARTIFACT_CLEANUP_BATCH,
    LASTFM_API_KEY: raw.LASTFM_API_KEY,
    LISTEN_SYNC_USER_MIN_INTERVAL_SEC: raw.LISTEN_SYNC_USER_MIN_INTERVAL_SEC,
    REALTIME_JWT_SECRET: raw.REALTIME_JWT_SECRET,
    LISTEN_REALTIME_PORT: raw.LISTEN_REALTIME_PORT,
    LISTEN_REALTIME_WS_URL: raw.LISTEN_REALTIME_WS_URL,
    FEATURE_FLAGS: raw.FEATURE_FLAGS,
    BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST: raw.BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST,
    BULLMQ_WORKER_CONCURRENCY_IMPORTS: raw.BULLMQ_WORKER_CONCURRENCY_IMPORTS,
    BULLMQ_WORKER_CONCURRENCY_EXPORTS: raw.BULLMQ_WORKER_CONCURRENCY_EXPORTS,
    BULLMQ_WORKER_CONCURRENCY_ANALYTICS: raw.BULLMQ_WORKER_CONCURRENCY_ANALYTICS,
    BULLMQ_WORKER_CONCURRENCY_SYNC: raw.BULLMQ_WORKER_CONCURRENCY_SYNC,
    BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC:
      raw.BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC,
    IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS: raw.IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS,
    IMPORT_LASTFM_PAGE_BURST: raw.IMPORT_LASTFM_PAGE_BURST,
    IMPORT_CANONICALIZATION_BATCH_SIZE: raw.IMPORT_CANONICALIZATION_BATCH_SIZE,
    IMPORT_CANONICALIZATION_BATCHES_PER_PAGE:
      raw.IMPORT_CANONICALIZATION_BATCHES_PER_PAGE,
    LISTEN_REALTIME_ENABLED: raw.LISTEN_REALTIME_ENABLED,
    VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT: raw.VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT,
    VS_STALLED_JOB_PROBE_SECONDS: raw.VS_STALLED_JOB_PROBE_SECONDS,
    VS_INTERNAL_API_SECRET: raw.VS_INTERNAL_API_SECRET,
    VS_TRUST_PROXY_HEADERS: raw.VS_TRUST_PROXY_HEADERS,
    VS_PUBLIC_APP_ORIGIN: raw.VS_PUBLIC_APP_ORIGIN,
    VS_WEB_INTERNAL_ORIGIN: raw.VS_WEB_INTERNAL_ORIGIN,
    VS_EMAIL_ENABLED: raw.VS_EMAIL_ENABLED,
    VS_EMAIL_TRANSPORT: raw.VS_EMAIL_TRANSPORT,
    VS_EMAIL_ALLOW_UNSAFE_MAILGUN: raw.VS_EMAIL_ALLOW_UNSAFE_MAILGUN,
    VS_WELCOME_EMAIL: raw.VS_WELCOME_EMAIL,
    MAILGUN_API_KEY: raw.MAILGUN_API_KEY,
    MAILGUN_DOMAIN: raw.MAILGUN_DOMAIN,
    MAILGUN_FROM: raw.MAILGUN_FROM,
    MAILGUN_REGION: raw.MAILGUN_REGION,
    ...pickAbuseEnvRaw(raw),
  });
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  return parsed.data;
}

let cached: ServerEnv | null = null;

export function loadServerEnv(): ServerEnv {
  if (!cached) {
    cached = parseServerEnv(process.env);
  }
  return cached;
}

/** Test-only hook to re-read process.env between cases. */
export function resetServerEnvCache(): void {
  cached = null;
}
