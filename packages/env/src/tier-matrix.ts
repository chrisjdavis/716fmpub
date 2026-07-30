/**
 * Explicit deploy-tier contracts for operators and reviewers.
 * Staging and production share the same *base* strict rules in `serverEnvSchema`;
 * production adds TLS for Redis (`rediss://`) only.
 */
export const STAGING_STRICT_REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "EXPORT_ARTIFACTS_DIR",
  "FEATURE_FLAGS (skipRedisQueues must be false)",
  "LISTEN_REALTIME_ENABLED / REALTIME_JWT_SECRET (see schema superRefine)",
  "VS_LOCAL_SEED_PASSWORD (must be unset)",
  "VS_INTERNAL_API_SECRET (optional; when set in strict tiers must be ≥32 chars; when unset, /api/internal/* returns 503)",
  "VS_SETUP_BOOTSTRAP_SECRET (required in staging/production; ≥32 chars; gates /setup instance claim)",
  "VS_TRUST_PROXY_HEADERS (explicit true|false reverse-proxy forwarded-header trust)",
  "VS_PUBLIC_APP_ORIGIN (canonical https origin for Host/Origin checks and HTTPS upgrade)",
] as const;

/**
 * Plain variable names that must stay documented in the repository root `.env.example`
 * so operators and CI can verify production/staging security configuration is not silently omitted.
 * Keep aligned with `STAGING_STRICT_REQUIRED_ENV_KEYS` and `serverEnvSchema` strict-tier rules.
 */
export const STAGING_STRICT_SECURITY_ENV_VAR_NAMES = [
  "VS_DEPLOY_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "EXPORT_ARTIFACTS_DIR",
  "FEATURE_FLAGS",
  "LISTEN_REALTIME_ENABLED",
  "REALTIME_JWT_SECRET",
  "VS_LOCAL_SEED_PASSWORD",
  "VS_INTERNAL_API_SECRET",
  "VS_SETUP_BOOTSTRAP_SECRET",
  "VS_TRUST_PROXY_HEADERS",
  "VS_PUBLIC_APP_ORIGIN",
] as const;

export const PRODUCTION_EXTRA_STRICT_RULES = [
  "REDIS_URL must use rediss:// (TLS to Redis)",
] as const;
