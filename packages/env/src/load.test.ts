import {
  EXPORT_ARTIFACT_RETENTION_SEC_DEFAULT,
  LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC_DEFAULT,
  LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC_DEFAULT,
  LAYER1_RECONCILE_USERS_PER_TICK_DEFAULT,
  LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT,
  LISTEN_SYNC_USER_MIN_INTERVAL_SEC_DEFAULT,
} from "@vs/domain";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerEnv, parseServerEnv, resetServerEnvCache } from "./load.js";

const TEST_REDIS_URL = "redis://127.0.0.1:6379";

function baseEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
    REDIS_URL: TEST_REDIS_URL,
    ...overrides,
  };
}

afterEach(() => {
  resetServerEnvCache();
});

describe("parseServerEnv", () => {
  it("accepts postgresql:// URLs", () => {
    const env = parseServerEnv({
      ...baseEnv(),
    });
    expect(env.DATABASE_URL).toContain("postgresql");
    expect(env.NODE_ENV).toBe("test");
    expect(env.deployEnv).toBe("test");
  });

  it("accepts postgres:// URLs", () => {
    const env = parseServerEnv({
      ...baseEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/app" }),
    });
    expect(env.DATABASE_URL).toContain("postgres://");
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "test",
        REDIS_URL: TEST_REDIS_URL,
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects missing REDIS_URL when Redis queues are enabled", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      }),
    ).toThrow(/REDIS_URL/);
  });

  it("allows omitting REDIS_URL when skipRedisQueues is true", () => {
    const env = parseServerEnv({
      ...baseEnv({ REDIS_URL: undefined }),
      FEATURE_FLAGS: '{"skipRedisQueues":true}',
    });
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.redisQueuesEnabled).toBe(false);
    expect(env.FEATURE_FLAGS.skipRedisQueues).toBe(true);
  });

  it("defaults redisQueuesEnabled to true when Redis is configured", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.redisQueuesEnabled).toBe(true);
    expect(env.REDIS_URL).toBe(TEST_REDIS_URL);
  });

  it("rejects non-redis schemes for REDIS_URL", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv({ REDIS_URL: "http://127.0.0.1:6379" }),
      }),
    ).toThrow(/redis/);
  });

  it("accepts rediss:// for REDIS_URL", () => {
    const env = parseServerEnv({
      ...baseEnv({ REDIS_URL: "rediss://127.0.0.1:6380" }),
    });
    expect(env.REDIS_URL).toBe("rediss://127.0.0.1:6380");
  });

  it("rejects non-postgres schemes", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv({ DATABASE_URL: "mysql://localhost:3306/db" }),
      }),
    ).toThrow(/postgres/);
  });

  it("rejects DATABASE_URL that is not a valid URL", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv({ DATABASE_URL: "postgres://not a valid url" }),
      }),
    ).toThrow(/valid URL/);
  });

  it("rejects DATABASE_URL without a database name in the path", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/" }),
      }),
    ).toThrow(/database name/);
  });

  it("treats empty LASTFM_API_KEY as unset", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      LASTFM_API_KEY: "",
    });
    expect(env.LASTFM_API_KEY).toBeUndefined();
  });

  it("trims LASTFM_API_KEY", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      LASTFM_API_KEY: "  abc  ",
    });
    expect(env.LASTFM_API_KEY).toBe("abc");
  });

  it("defaults LISTEN_SYNC_USER_MIN_INTERVAL_SEC from domain", () => {
    const env = parseServerEnv({
      ...baseEnv(),
    });
    expect(env.LISTEN_SYNC_USER_MIN_INTERVAL_SEC).toBe(
      LISTEN_SYNC_USER_MIN_INTERVAL_SEC_DEFAULT,
    );
  });

  it("accepts LISTEN_SYNC_USER_MIN_INTERVAL_SEC override", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      LISTEN_SYNC_USER_MIN_INTERVAL_SEC: "300",
    });
    expect(env.LISTEN_SYNC_USER_MIN_INTERVAL_SEC).toBe(300);
  });

  it("rejects LISTEN_SYNC_USER_MIN_INTERVAL_SEC below 30", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        LISTEN_SYNC_USER_MIN_INTERVAL_SEC: "10",
      }),
    ).toThrow(/LISTEN_SYNC_USER_MIN_INTERVAL_SEC/);
  });

  it("defaults Layer 1 reconciliation tick env from domain (VS-83)", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC).toBe(
      LAYER1_RECONCILE_TICK_MIN_INTERVAL_SEC_DEFAULT,
    );
    expect(env.LAYER1_RECONCILE_USERS_PER_TICK).toBe(
      LAYER1_RECONCILE_USERS_PER_TICK_DEFAULT,
    );
    expect(env.LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC).toBe(
      LAYER1_RECONCILE_FAILED_RETRY_COOLDOWN_SEC_DEFAULT,
    );
    expect(env.LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES).toBe(
      LAYER1_RECOMPUTE_MAX_CONSECUTIVE_FAILURES_DEFAULT,
    );
  });

  it("defaults FEATURE_FLAGS so skipRedisQueues is false", () => {
    const env = parseServerEnv({
      ...baseEnv(),
    });
    expect(env.FEATURE_FLAGS).toEqual({
      skipRedisQueues: false,
      signupsDisabled: false,
    });
  });

  it("defaults EXPORT_ARTIFACTS_DIR when unset", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.EXPORT_ARTIFACTS_DIR).toContain("vs-export-artifacts");
  });

  it("honors EXPORT_ARTIFACTS_DIR when set", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      EXPORT_ARTIFACTS_DIR: "/var/lib/vs/exports",
    });
    expect(env.EXPORT_ARTIFACTS_DIR).toBe("/var/lib/vs/exports");
  });

  it("defaults EXPORT_ARTIFACT_RETENTION_SEC from domain", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.EXPORT_ARTIFACT_RETENTION_SEC).toBe(EXPORT_ARTIFACT_RETENTION_SEC_DEFAULT);
  });

  it("accepts EXPORT_ARTIFACT_RETENTION_SEC override", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      EXPORT_ARTIFACT_RETENTION_SEC: "3600",
    });
    expect(env.EXPORT_ARTIFACT_RETENTION_SEC).toBe(3600);
  });

  it("rejects EXPORT_ARTIFACT_RETENTION_SEC below 300", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        EXPORT_ARTIFACT_RETENTION_SEC: "60",
      }),
    ).toThrow(/EXPORT_ARTIFACT_RETENTION_SEC/);
  });

  it("defaults EXPORT_ARTIFACT_CLEANUP_BATCH to 100", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.EXPORT_ARTIFACT_CLEANUP_BATCH).toBe(100);
  });

  it("accepts FEATURE_FLAGS as empty JSON object", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      FEATURE_FLAGS: "{}",
    });
    expect(env.FEATURE_FLAGS).toEqual({
      skipRedisQueues: false,
      signupsDisabled: false,
    });
  });

  it("rejects invalid FEATURE_FLAGS JSON", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        FEATURE_FLAGS: "{",
      }),
    ).toThrow(/FEATURE_FLAGS|feature-flags|valid JSON/i);
  });

  it("defaults BullMQ worker concurrency fields", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.BULLMQ_WORKER_CONCURRENCY_SMOKE_TEST).toBe(1);
    expect(env.BULLMQ_WORKER_CONCURRENCY_IMPORTS).toBe(2);
    expect(env.BULLMQ_WORKER_CONCURRENCY_EXPORTS).toBe(1);
    expect(env.BULLMQ_WORKER_CONCURRENCY_ANALYTICS).toBe(1);
    expect(env.BULLMQ_WORKER_CONCURRENCY_SYNC).toBe(2);
    expect(env.BULLMQ_WORKER_CONCURRENCY_INCREMENTAL_SYNC).toBe(2);
  });

  it("accepts BULLMQ_WORKER_CONCURRENCY_IMPORTS override", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      BULLMQ_WORKER_CONCURRENCY_IMPORTS: "4",
    });
    expect(env.BULLMQ_WORKER_CONCURRENCY_IMPORTS).toBe(4);
  });

  it("rejects BULLMQ_WORKER_CONCURRENCY_IMPORTS below 1", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        BULLMQ_WORKER_CONCURRENCY_IMPORTS: "0",
      }),
    ).toThrow(/BULLMQ_WORKER_CONCURRENCY_IMPORTS/);
  });

  it("rejects BULLMQ_WORKER_CONCURRENCY_IMPORTS above 64", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        BULLMQ_WORKER_CONCURRENCY_IMPORTS: "99",
      }),
    ).toThrow(/BULLMQ_WORKER_CONCURRENCY_IMPORTS/);
  });

  it("defaults IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS and IMPORT_LASTFM_PAGE_BURST", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS).toBe(200);
    expect(env.IMPORT_LASTFM_PAGE_BURST).toBe(3);
    expect(env.IMPORT_CANONICALIZATION_BATCH_SIZE).toBe(200);
    expect(env.IMPORT_CANONICALIZATION_BATCHES_PER_PAGE).toBe(1);
  });

  it("accepts IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS override including zero", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS: "0",
      IMPORT_LASTFM_PAGE_BURST: "5",
      IMPORT_CANONICALIZATION_BATCH_SIZE: "100",
      IMPORT_CANONICALIZATION_BATCHES_PER_PAGE: "2",
    });
    expect(env.IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS).toBe(0);
    expect(env.IMPORT_LASTFM_PAGE_BURST).toBe(5);
    expect(env.IMPORT_CANONICALIZATION_BATCH_SIZE).toBe(100);
    expect(env.IMPORT_CANONICALIZATION_BATCHES_PER_PAGE).toBe(2);
  });

  it("rejects IMPORT_LASTFM_PAGE_BURST below 1", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        IMPORT_LASTFM_PAGE_BURST: "0",
      }),
    ).toThrow(/IMPORT_LASTFM_PAGE_BURST/);
  });

  it("rejects invalid canonicalization import hardening overrides", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        IMPORT_CANONICALIZATION_BATCH_SIZE: "10",
      }),
    ).toThrow(/IMPORT_CANONICALIZATION_BATCH_SIZE/);
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        IMPORT_CANONICALIZATION_BATCHES_PER_PAGE: "11",
      }),
    ).toThrow(/IMPORT_CANONICALIZATION_BATCHES_PER_PAGE/);
  });

  it("rejects REALTIME_JWT_SECRET shorter than 16 characters when set in development", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        REALTIME_JWT_SECRET: "123456789012345",
      }),
    ).toThrow(/REALTIME_JWT_SECRET/);
  });

  it("rejects VS_INTERNAL_API_SECRET shorter than 16 characters when set in development", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_INTERNAL_API_SECRET: "123456789012345",
      }),
    ).toThrow(/VS_INTERNAL_API_SECRET/);
  });

  it("rejects invalid VS_DEPLOY_ENV value", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_DEPLOY_ENV: "qa",
      }),
    ).toThrow();
  });

  it("rejects VS_PUBLIC_APP_ORIGIN when set but not a valid URL", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv({ VS_PUBLIC_APP_ORIGIN: "not-a-url" }),
      }),
    ).toThrow(/VS_PUBLIC_APP_ORIGIN/);
  });

  it("infers production deploy rules from NODE_ENV production", () => {
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
        REDIS_URL: TEST_REDIS_URL,
        FEATURE_FLAGS: "{}",
      }),
    ).toThrow(/EXPORT_ARTIFACTS_DIR|REDIS_URL|VS_TRUST_PROXY_HEADERS|VS_PUBLIC_APP_ORIGIN/);
  });

  it("accepts NODE_ENV production when strict configuration is complete", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      REDIS_URL: "rediss://127.0.0.1:6379",
      EXPORT_ARTIFACTS_DIR: "/var/lib/vs/exports",
      LISTEN_REALTIME_ENABLED: "false",
      FEATURE_FLAGS: "{}",
      VS_TRUST_PROXY_HEADERS: "false",
      VS_PUBLIC_APP_ORIGIN: "https://app.example.com",
    });
    expect(env.deployEnv).toBe("production");
    expect(env.EXPORT_ARTIFACTS_DIR).toBe("/var/lib/vs/exports");
    expect(env.trustProxyHeaders).toBe(false);
    expect(env.publicAppOrigin).toBe("https://app.example.com");
  });

  it("honors explicit VS_DEPLOY_ENV=staging when strict fields are satisfied", () => {
    const env = parseServerEnv({
      ...baseEnv({
        VS_DEPLOY_ENV: "staging",
        EXPORT_ARTIFACTS_DIR: "/var/lib/vs/staging-exports",
        REDIS_URL: "redis://127.0.0.1:6379",
        LISTEN_REALTIME_ENABLED: "false",
        VS_TRUST_PROXY_HEADERS: "true",
        VS_PUBLIC_APP_ORIGIN: "https://staging.example.com",
      }),
    });
    expect(env.deployEnv).toBe("staging");
    expect(env.trustProxyHeaders).toBe(true);
    expect(env.publicAppOrigin).toBe("https://staging.example.com");
  });

  it("parses optional operator tuning variables", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT: "20",
      VS_STALLED_JOB_PROBE_SECONDS: "120",
    });
    expect(env.VS_QUEUE_INSPECT_JOB_SAMPLE_LIMIT).toBe(20);
    expect(env.VS_STALLED_JOB_PROBE_SECONDS).toBe(120);
  });

  it("rejects VS_STALLED_JOB_PROBE_SECONDS out of range", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_STALLED_JOB_PROBE_SECONDS: "0",
      }),
    ).toThrow(/VS_STALLED_JOB_PROBE_SECONDS/);
  });

  it("parses outbound email disabled with no Mailgun variables", () => {
    const env = parseServerEnv({ ...baseEnv() });
    expect(env.emailOutboundEnabled).toBe(false);
    expect(env.mailgunOutbound).toBeUndefined();
  });

  it("defaults test deploy to capture transport without Mailgun credentials", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      VS_EMAIL_ENABLED: "true",
    });
    expect(env.emailOutboundEnabled).toBe(true);
    expect(env.emailTransport).toBe("capture");
    expect(env.mailgunOutbound).toBeUndefined();
  });

  it("accepts VS_EMAIL_ENABLED=true with noop transport and no Mailgun variables", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      VS_EMAIL_ENABLED: "true",
      VS_EMAIL_TRANSPORT: "noop",
    });
    expect(env.emailTransport).toBe("noop");
    expect(env.mailgunOutbound).toBeUndefined();
  });

  it("accepts VS_EMAIL_ENABLED=true with valid Mailgun configuration when transport is mailgun and unsafe opt-in is set", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      VS_EMAIL_ENABLED: "true",
      VS_EMAIL_TRANSPORT: "mailgun",
      VS_EMAIL_ALLOW_UNSAFE_MAILGUN: "true",
      MAILGUN_API_KEY: "k".repeat(32),
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_FROM: "716FM <noreply@mg.example.com>",
      MAILGUN_REGION: "eu",
    });
    expect(env.emailOutboundEnabled).toBe(true);
    expect(env.emailTransport).toBe("mailgun");
    expect(env.mailgunOutbound?.region).toBe("eu");
    expect(env.mailgunOutbound?.messagesUrl).toBe(
      "https://api.eu.mailgun.net/v3/mg.example.com/messages",
    );
    expect(env.mailgunOutbound?.from).toBe("716FM <noreply@mg.example.com>");
  });

  it("defaults Mailgun region to us when transport is mailgun and MAILGUN_REGION is unset", () => {
    const env = parseServerEnv({
      ...baseEnv(),
      VS_EMAIL_ENABLED: "true",
      VS_EMAIL_TRANSPORT: "mailgun",
      VS_EMAIL_ALLOW_UNSAFE_MAILGUN: "true",
      MAILGUN_API_KEY: "k".repeat(32),
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_FROM: "noreply@mg.example.com",
    });
    expect(env.mailgunOutbound?.region).toBe("us");
    expect(env.mailgunOutbound?.messagesUrl).toBe(
      "https://api.mailgun.net/v3/mg.example.com/messages",
    );
  });

  it("rejects mailgun transport in test without VS_EMAIL_ALLOW_UNSAFE_MAILGUN", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_EMAIL_ENABLED: "true",
        VS_EMAIL_TRANSPORT: "mailgun",
        MAILGUN_API_KEY: "k".repeat(32),
        MAILGUN_DOMAIN: "mg.example.com",
        MAILGUN_FROM: "noreply@mg.example.com",
      }),
    ).toThrow(/VS_EMAIL_ALLOW_UNSAFE_MAILGUN/);
  });

  it("rejects mailgun transport when MAILGUN_API_KEY is missing", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_EMAIL_ENABLED: "true",
        VS_EMAIL_TRANSPORT: "mailgun",
        VS_EMAIL_ALLOW_UNSAFE_MAILGUN: "true",
        MAILGUN_DOMAIN: "mg.example.com",
        MAILGUN_FROM: "noreply@mg.example.com",
      }),
    ).toThrow(/MAILGUN_API_KEY/);
  });

  it("rejects mailgun transport when MAILGUN_API_KEY is too short", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_EMAIL_ENABLED: "true",
        VS_EMAIL_TRANSPORT: "mailgun",
        VS_EMAIL_ALLOW_UNSAFE_MAILGUN: "true",
        MAILGUN_API_KEY: "short",
        MAILGUN_DOMAIN: "mg.example.com",
        MAILGUN_FROM: "noreply@mg.example.com",
      }),
    ).toThrow(/MAILGUN_API_KEY/);
  });

  it("rejects Mailgun variables when VS_EMAIL_ENABLED is not true", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        MAILGUN_API_KEY: "k".repeat(32),
      }),
    ).toThrow(/VS_EMAIL_ENABLED/);
  });

  it("rejects MAILGUN_FROM without a valid email when transport is mailgun", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_EMAIL_ENABLED: "true",
        VS_EMAIL_TRANSPORT: "mailgun",
        VS_EMAIL_ALLOW_UNSAFE_MAILGUN: "true",
        MAILGUN_API_KEY: "k".repeat(32),
        MAILGUN_DOMAIN: "mg.example.com",
        MAILGUN_FROM: "not-an-email",
      }),
    ).toThrow(/MAILGUN_FROM/);
  });

  it("rejects VS_EMAIL_TRANSPORT when outbound email is disabled", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_EMAIL_TRANSPORT: "noop",
      }),
    ).toThrow(/VS_EMAIL_TRANSPORT/);
  });

  it("rejects partial Mailgun variables when transport is capture", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_EMAIL_ENABLED: "true",
        VS_EMAIL_TRANSPORT: "capture",
        MAILGUN_API_KEY: "k".repeat(32),
      }),
    ).toThrow(/MAILGUN_API_KEY/);
  });

  it("defaults welcomeEmailTrigger to off and accepts VS_WELCOME_EMAIL values", () => {
    expect(parseServerEnv({ ...baseEnv() }).welcomeEmailTrigger).toBe("off");
    expect(
      parseServerEnv({ ...baseEnv(), VS_WELCOME_EMAIL: "signup" }).welcomeEmailTrigger,
    ).toBe("signup");
    expect(
      parseServerEnv({ ...baseEnv(), VS_WELCOME_EMAIL: "email_verified" }).welcomeEmailTrigger,
    ).toBe("email_verified");
  });

  it("rejects invalid VS_WELCOME_EMAIL", () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv(),
        VS_WELCOME_EMAIL: "sometimes",
      }),
    ).toThrow();
  });
});

describe("strict staging and production deploy rules", () => {
  const PROD_REDIS = "rediss://127.0.0.1:6379";

  function strictBase(
    overrides: Record<string, string | undefined> = {},
  ): Record<string, string | undefined> {
    return {
      VS_DEPLOY_ENV: "production",
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/app",
      REDIS_URL: PROD_REDIS,
      EXPORT_ARTIFACTS_DIR: "/var/lib/vs/export-artifacts",
      LISTEN_REALTIME_ENABLED: "false",
      FEATURE_FLAGS: "{}",
      VS_TRUST_PROXY_HEADERS: "true",
      VS_PUBLIC_APP_ORIGIN: "https://app.example.com",
      ...overrides,
    };
  }

  it("accepts production VS_DEPLOY_ENV with TLS Redis and realtime disabled", () => {
    const env = parseServerEnv(strictBase());
    expect(env.deployEnv).toBe("production");
    expect(env.REDIS_URL).toMatch(/^rediss:/);
  });

  it("accepts staging VS_DEPLOY_ENV with redis:// and realtime disabled", () => {
    const env = parseServerEnv(
      strictBase({
        VS_DEPLOY_ENV: "staging",
        EXPORT_ARTIFACTS_DIR: "/var/lib/vs/staging-artifacts",
        REDIS_URL: "redis://127.0.0.1:6379",
      }),
    );
    expect(env.deployEnv).toBe("staging");
    expect(env.REDIS_URL).toMatch(/^redis:/);
  });

  it("rejects production when REDIS_URL is not rediss://", () => {
    expect(() =>
      parseServerEnv(
        strictBase({
          REDIS_URL: "redis://127.0.0.1:6379",
        }),
      ),
    ).toThrow(/rediss/);
  });

  it("rejects strict deploy when EXPORT_ARTIFACTS_DIR is missing", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({ EXPORT_ARTIFACTS_DIR: undefined }),
      }),
    ).toThrow(/EXPORT_ARTIFACTS_DIR/);
  });

  it("rejects strict deploy when EXPORT_ARTIFACTS_DIR is blank", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({ EXPORT_ARTIFACTS_DIR: "   " }),
      }),
    ).toThrow(/EXPORT_ARTIFACTS_DIR/);
  });

  it("rejects strict deploy when skipRedisQueues is enabled", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase(),
        FEATURE_FLAGS: '{"skipRedisQueues":true}',
      }),
    ).toThrow(/skipRedisQueues/);
  });

  it("rejects strict deploy when LISTEN_REALTIME_ENABLED=true but REALTIME_JWT_SECRET is missing", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({
          LISTEN_REALTIME_ENABLED: "true",
          REALTIME_JWT_SECRET: undefined,
        }),
      }),
    ).toThrow(/REALTIME_JWT_SECRET/);
  });

  it("accepts strict production without REALTIME when LISTEN_REALTIME_ENABLED=false", () => {
    const env = parseServerEnv(
      strictBase({
        LISTEN_REALTIME_ENABLED: "false",
        REALTIME_JWT_SECRET: undefined,
      }),
    );
    expect(env.REALTIME_JWT_SECRET).toBeUndefined();
  });

  it("rejects strict deploy when REALTIME_JWT_SECRET is too short while enabled", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({
          LISTEN_REALTIME_ENABLED: "true",
          REALTIME_JWT_SECRET: "x".repeat(31),
        }),
      }),
    ).toThrow(/REALTIME_JWT_SECRET/);
  });

  it("rejects strict deploy when REALTIME_JWT_SECRET is too short without explicit disable", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({
          LISTEN_REALTIME_ENABLED: undefined,
          REALTIME_JWT_SECRET: "short",
        }),
      }),
    ).toThrow(/REALTIME_JWT_SECRET/);
  });

  it("rejects strict deploy when VS_LOCAL_SEED_PASSWORD is set", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase(),
        VS_LOCAL_SEED_PASSWORD: "local-only",
      }),
    ).toThrow(/VS_LOCAL_SEED_PASSWORD/);
  });

  it("accepts strict deploy when VS_INTERNAL_API_SECRET is unset", () => {
    const env = parseServerEnv(strictBase({ VS_INTERNAL_API_SECRET: undefined }));
    expect(env.VS_INTERNAL_API_SECRET).toBeUndefined();
  });

  it("rejects strict deploy when VS_INTERNAL_API_SECRET is set but shorter than 32", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({ VS_INTERNAL_API_SECRET: "x".repeat(31) }),
      }),
    ).toThrow(/VS_INTERNAL_API_SECRET/);
  });

  it("accepts strict deploy when VS_INTERNAL_API_SECRET is at least 32 characters", () => {
    const env = parseServerEnv({
      ...strictBase({ VS_INTERNAL_API_SECRET: "z".repeat(32) }),
    });
    expect(env.VS_INTERNAL_API_SECRET).toHaveLength(32);
  });

  it("rejects strict deploy when VS_TRUST_PROXY_HEADERS is unset", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({ VS_TRUST_PROXY_HEADERS: undefined }),
      }),
    ).toThrow(/VS_TRUST_PROXY_HEADERS/);
  });

  it("rejects strict deploy when VS_PUBLIC_APP_ORIGIN uses http", () => {
    expect(() =>
      parseServerEnv({
        ...strictBase({ VS_PUBLIC_APP_ORIGIN: "http://app.example.com" }),
      }),
    ).toThrow(/https/);
  });

  it("accepts strict production with outbound email and default mailgun transport", () => {
    const env = parseServerEnv(
      strictBase({
        VS_EMAIL_ENABLED: "true",
        MAILGUN_API_KEY: "k".repeat(32),
        MAILGUN_DOMAIN: "mg.example.com",
        MAILGUN_FROM: "noreply@mg.example.com",
      }),
    );
    expect(env.emailTransport).toBe("mailgun");
    expect(env.mailgunOutbound?.domain).toBe("mg.example.com");
  });

  it("rejects strict deploy when VS_EMAIL_ENABLED and transport is capture", () => {
    expect(() =>
      parseServerEnv(
        strictBase({
          VS_EMAIL_ENABLED: "true",
          VS_EMAIL_TRANSPORT: "capture",
          MAILGUN_API_KEY: "k".repeat(32),
          MAILGUN_DOMAIN: "mg.example.com",
          MAILGUN_FROM: "noreply@mg.example.com",
        }),
      ),
    ).toThrow(/Staging and production require real Mailgun/);
  });

  it("rejects VS_EMAIL_ALLOW_UNSAFE_MAILGUN in strict deploy tiers", () => {
    expect(() =>
      parseServerEnv(
        strictBase({
          VS_EMAIL_ENABLED: "true",
          VS_EMAIL_ALLOW_UNSAFE_MAILGUN: "true",
          MAILGUN_API_KEY: "k".repeat(32),
          MAILGUN_DOMAIN: "mg.example.com",
          MAILGUN_FROM: "noreply@mg.example.com",
        }),
      ),
    ).toThrow(/VS_EMAIL_ALLOW_UNSAFE_MAILGUN applies only/);
  });
});

describe("loadServerEnv", () => {
  it("memoizes parsed env", () => {
    resetServerEnvCache();
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/app";
    process.env.REDIS_URL = TEST_REDIS_URL;
    expect(loadServerEnv()).toBe(loadServerEnv());
  });
});
