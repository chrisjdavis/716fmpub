import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { LastfmImportListenEvent } from "@vs/lastfm-provider";
import {
  LastfmUsernameNotFoundError,
  fetchLastfmRecentTrackPages,
} from "@vs/lastfm-provider";
import {
  applyMigrationsToPglite,
  pgliteAsPool,
} from "@vs/db/test/pgliteHarness";
import {
  createExportJob,
  DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND,
  LISTEN_FINGERPRINT_SNAPSHOT_KIND,
  USER_WINDOW_SIGNALS_SNAPSHOT_KIND,
} from "@vs/db";
import type { ServerEnv } from "@vs/env";
import { parseServerEnv } from "@vs/env";
import {
  ANALYTICS_QUEUE_JOB_NAME,
  createBullMqRedisConnection,
  enqueueAnalyticsJob,
  enqueueExportsJob,
  enqueueImportsJob,
  EXPORTS_QUEUE_JOB_NAME,
  IMPORTS_QUEUE_JOB_NAME,
  verifyRedisConnectivity,
  VS_QUEUE_NAMES,
} from "@vs/queue";
import { Queue, QueueEvents, Worker } from "bullmq";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processAnalyticsJob } from "./analyticsQueueProcessor.js";
import { processExportsJob } from "./exportQueueProcessor.js";
import { processImportsJob } from "./importQueueProcessor.js";

vi.mock("@vs/lastfm-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/lastfm-provider")>();
  return {
    ...actual,
    fetchLastfmRecentTrackPages: vi.fn(),
  };
});

const { enqueueDashboardAnalyticsAfterImportMock } = vi.hoisted(() => ({
  enqueueDashboardAnalyticsAfterImportMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./enqueueDashboardAnalyticsAfterImport.js", () => ({
  enqueueDashboardAnalyticsAfterImport: enqueueDashboardAnalyticsAfterImportMock,
}));

const mockedFetch = vi.mocked(fetchLastfmRecentTrackPages);

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** CI always runs these; locally opt in with `VS_QUEUE_E2E=1` and a reachable `REDIS_URL`. */
const runQueueE2e = process.env.CI === "true" || process.env.VS_QUEUE_E2E === "1";

function redisUrlForE2e(): string {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

function baseServerEnv(): ServerEnv {
  return parseServerEnv({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/testdb",
    REDIS_URL: redisUrlForE2e(),
    EXPORT_ARTIFACTS_DIR: path.join(os.tmpdir(), `vs-queue-e2e-artifacts-${crypto.randomUUID()}`),
    LASTFM_API_KEY: "e2e-worker-key",
    LISTEN_SYNC_USER_MIN_INTERVAL_SEC: "120",
    LISTEN_REALTIME_PORT: "3457",
    IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS: "0",
    FEATURE_FLAGS: "{}",
  });
}

function sampleListenPage(): readonly LastfmImportListenEvent[] {
  return [
    {
      uts: 1_714_100_000n,
      playedAt: "2026-04-14T12:00:00.000Z",
      artistName: "E2E Artist",
      albumName: "E2E Album",
      trackName: "E2E Track A",
      artistMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      albumMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
      trackMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
      loved: false,
      trackUrl: null,
      rawPayload: { name: "E2E Track A" },
    },
  ];
}

describe.skipIf(!runQueueE2e).sequential("VS-38 queue flows e2e (BullMQ + PGlite)", () => {
  let pglite: PGlite;
  let pool: Pool;
  let serverEnv: ServerEnv;
  let redisReachable = false;

  beforeAll(async () => {
    serverEnv = baseServerEnv();
    const ping = await verifyRedisConnectivity(serverEnv);
    if (!ping.ok) {
      throw new Error(
        `[queue e2e] Redis unreachable (${ping.reason}). CI must expose Redis on REDIS_URL.`,
      );
    }
    redisReachable = true;
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
    pool = pgliteAsPool(pglite) as unknown as Pool;
  });

  afterAll(async () => {
    if (redisReachable) {
      await pglite.close();
    }
  });

  beforeEach(async () => {
    if (!redisReachable) {
      return;
    }
    mockedFetch.mockReset();
    enqueueDashboardAnalyticsAfterImportMock.mockClear();
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'e2e-queue@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
  });

  async function drainRedisPrefix(
    connection: ReturnType<typeof createBullMqRedisConnection>,
    prefix: string,
  ): Promise<void> {
    const pattern = `${prefix}*`;
    let cursor = "0";
    do {
      const [next, keys] = await connection.scan(cursor, "MATCH", pattern, "COUNT", "200");
      cursor = next;
      if (keys.length > 0) {
        await connection.del(...keys);
      }
    } while (cursor !== "0");
  }

  it(
    "imports queue: enqueued lastfm_rows_import completes and persists scrobbles",
    { timeout: 60_000 },
    async () => {
      const importJobId = crypto.randomUUID();
      const page = sampleListenPage();
      mockedFetch.mockImplementation(async function* () {
        yield page;
      });

      await pglite.query(
        `insert into import_jobs (id, user_id, label, stage, lastfm_username)
         values ($1::uuid, $2::uuid, 'e2e', 'queued', 'fixture_user')`,
        [importJobId, USER_ID],
      );

      const prefix = `e2evs38:${crypto.randomUUID()}`;
      const connection = createBullMqRedisConnection(serverEnv);
      const importQueue = new Queue(VS_QUEUE_NAMES.IMPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const importEvents = new QueueEvents(VS_QUEUE_NAMES.IMPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const worker = new Worker(
        VS_QUEUE_NAMES.IMPORTS,
        (job) => processImportsJob(job, pool, serverEnv),
        {
          connection: connection.duplicate(),
          prefix,
          concurrency: 1,
        },
      );

      try {
        await importEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await enqueueImportsJob(importQueue, {
          name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
          data: { importJobId, userId: USER_ID },
        });
        await job.waitUntilFinished(importEvents, 45_000);

        const jobRes = await pglite.query<{ stage: string }>(
          `select stage from import_jobs where id = $1::uuid`,
          [importJobId],
        );
        expect(jobRes.rows[0]?.stage).toBe("completed");

        const rawRes = await pglite.query<{ n: string }>(
          `select count(*)::text as n from raw_scrobbles where import_job_id = $1::uuid`,
          [importJobId],
        );
        expect(rawRes.rows[0]?.n).toBe("1");
        expect(enqueueDashboardAnalyticsAfterImportMock).toHaveBeenCalledWith(
          serverEnv,
          USER_ID,
          expect.objectContaining({ listenPeriodMetricsMode: "full" }),
        );
      } finally {
        await worker.close();
        await importEvents.close();
        await importQueue.obliterate({ force: true });
        await importQueue.close();
        await drainRedisPrefix(connection, prefix);
        await connection.quit();
      }
    },
  );

  it(
    "imports queue: invalid payload fails the BullMQ job (UnrecoverableError)",
    { timeout: 60_000 },
    async () => {
      const prefix = `e2evs38:${crypto.randomUUID()}`;
      const connection = createBullMqRedisConnection(serverEnv);
      const importQueue = new Queue(VS_QUEUE_NAMES.IMPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const importEvents = new QueueEvents(VS_QUEUE_NAMES.IMPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const worker = new Worker(
        VS_QUEUE_NAMES.IMPORTS,
        (job) => processImportsJob(job, pool, serverEnv),
        {
          connection: connection.duplicate(),
          prefix,
          concurrency: 1,
        },
      );

      try {
        await importEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await importQueue.add(
          IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
          { importJobId: "not-a-uuid", userId: USER_ID },
        );
        await expect(job.waitUntilFinished(importEvents, 45_000)).rejects.toThrow();
        const failed = await job.getState();
        expect(failed).toBe("failed");
      } finally {
        await worker.close();
        await importEvents.close();
        await importQueue.obliterate({ force: true });
        await importQueue.close();
        await drainRedisPrefix(connection, prefix);
        await connection.quit();
      }
    },
  );

  it(
    "imports queue: provider not-found marks import_jobs failed without BullMQ retry storm",
    { timeout: 60_000 },
    async () => {
      const importJobId = crypto.randomUUID();
      mockedFetch.mockImplementation(async function* () {
        throw new LastfmUsernameNotFoundError("Last.fm user not found: no_such_user");
      });

      await pglite.query(
        `insert into import_jobs (id, user_id, label, stage, lastfm_username)
         values ($1::uuid, $2::uuid, 'bad user', 'queued', 'no_such_user')`,
        [importJobId, USER_ID],
      );

      const prefix = `e2evs38:${crypto.randomUUID()}`;
      const connection = createBullMqRedisConnection(serverEnv);
      const importQueue = new Queue(VS_QUEUE_NAMES.IMPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const importEvents = new QueueEvents(VS_QUEUE_NAMES.IMPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const worker = new Worker(
        VS_QUEUE_NAMES.IMPORTS,
        (job) => processImportsJob(job, pool, serverEnv),
        {
          connection: connection.duplicate(),
          prefix,
          concurrency: 1,
        },
      );

      try {
        await importEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await enqueueImportsJob(importQueue, {
          name: IMPORTS_QUEUE_JOB_NAME.LASTFM_ROWS_IMPORT,
          data: { importJobId, userId: USER_ID },
        });
        await job.waitUntilFinished(importEvents, 45_000);

        const jobRes = await pglite.query<{ stage: string; error_message: string | null }>(
          `select stage, error_message from import_jobs where id = $1::uuid`,
          [importJobId],
        );
        expect(jobRes.rows[0]?.stage).toBe("failed");
        expect(jobRes.rows[0]?.error_message).toContain("not found");
        expect(enqueueDashboardAnalyticsAfterImportMock).not.toHaveBeenCalled();
      } finally {
        await worker.close();
        await importEvents.close();
        await importQueue.obliterate({ force: true });
        await importQueue.close();
        await drainRedisPrefix(connection, prefix);
        await connection.quit();
      }
    },
  );

  it(
    "exports queue: completes an empty listen export and marks export_jobs completed",
    { timeout: 60_000 },
    async () => {
      const { id: exportJobId } = await createExportJob(pool, {
        userId: USER_ID,
        format: "json",
      });

      const prefix = `e2evs38:${crypto.randomUUID()}`;
      const connection = createBullMqRedisConnection(serverEnv);
      const exportQueue = new Queue(VS_QUEUE_NAMES.EXPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const exportEvents = new QueueEvents(VS_QUEUE_NAMES.EXPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const worker = new Worker(
        VS_QUEUE_NAMES.EXPORTS,
        (job) => processExportsJob(job, pool, serverEnv),
        {
          connection: connection.duplicate(),
          prefix,
          concurrency: 1,
        },
      );

      try {
        await exportEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await enqueueExportsJob(exportQueue, {
          name: EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE,
          data: { exportJobId, userId: USER_ID },
        });
        await job.waitUntilFinished(exportEvents, 45_000);

        const row = await pglite.query<{
          stage: string;
          artifact_relative_path: string | null;
          artifact_delivery_token: string | null;
        }>(
          `select stage, artifact_relative_path, artifact_delivery_token
           from export_jobs where id = $1::uuid`,
          [exportJobId],
        );
        expect(row.rows[0]?.stage).toBe("completed");
        expect(row.rows[0]?.artifact_relative_path).toBe(`${USER_ID}/${exportJobId}.zip`);
        expect(row.rows[0]?.artifact_delivery_token).toBeTruthy();
        expect(String(row.rows[0]?.artifact_delivery_token).length).toBeGreaterThanOrEqual(32);
      } finally {
        await worker.close();
        await exportEvents.close();
        await exportQueue.obliterate({ force: true });
        await exportQueue.close();
        await drainRedisPrefix(connection, prefix);
        await connection.quit();
      }
    },
  );

  it(
    "exports queue: missing export row fails the BullMQ job",
    { timeout: 60_000 },
    async () => {
      const missingExportId = crypto.randomUUID();
      const prefix = `e2evs38:${crypto.randomUUID()}`;
      const connection = createBullMqRedisConnection(serverEnv);
      const exportQueue = new Queue(VS_QUEUE_NAMES.EXPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const exportEvents = new QueueEvents(VS_QUEUE_NAMES.EXPORTS, {
        connection: connection.duplicate(),
        prefix,
      });
      const worker = new Worker(
        VS_QUEUE_NAMES.EXPORTS,
        (job) => processExportsJob(job, pool, serverEnv),
        {
          connection: connection.duplicate(),
          prefix,
          concurrency: 1,
        },
      );

      try {
        await exportEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await enqueueExportsJob(exportQueue, {
          name: EXPORTS_QUEUE_JOB_NAME.USER_DATA_PACKAGE,
          data: { exportJobId: missingExportId, userId: USER_ID },
        });
        await expect(job.waitUntilFinished(exportEvents, 45_000)).rejects.toThrow();
        expect(await job.getState()).toBe("failed");
      } finally {
        await worker.close();
        await exportEvents.close();
        await exportQueue.obliterate({ force: true });
        await exportQueue.close();
        await drainRedisPrefix(connection, prefix);
        await connection.quit();
      }
    },
  );

  it(
    "analytics queue: windowed_aggregate persists dashboard bundle snapshot",
    { timeout: 60_000 },
    async () => {
      const anchorIso = "2026-04-14T12:00:00.000Z";
      const prefix = `e2evs38:${crypto.randomUUID()}`;
      const connection = createBullMqRedisConnection(serverEnv);
      const analyticsQueue = new Queue(VS_QUEUE_NAMES.ANALYTICS, {
        connection: connection.duplicate(),
        prefix,
      });
      const analyticsEvents = new QueueEvents(VS_QUEUE_NAMES.ANALYTICS, {
        connection: connection.duplicate(),
        prefix,
      });
      const worker = new Worker(
        VS_QUEUE_NAMES.ANALYTICS,
        (job) => processAnalyticsJob(job, pool, serverEnv),
        {
          connection: connection.duplicate(),
          prefix,
          concurrency: 1,
        },
      );

      try {
        await analyticsEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await enqueueAnalyticsJob(analyticsQueue, {
          name: ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE,
          data: {
            windowStartIso: "1970-01-01T00:00:00.000Z",
            windowEndIso: anchorIso,
            userId: USER_ID,
          },
        });
        await job.waitUntilFinished(analyticsEvents, 45_000);

        const snap = await pglite.query<{ kind: string }>(
          `select kind from analytics_snapshots
           where user_id = $1::uuid and kind in ($2, $3, $4)
           order by kind`,
          [
            USER_ID,
            DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND,
            LISTEN_FINGERPRINT_SNAPSHOT_KIND,
            USER_WINDOW_SIGNALS_SNAPSHOT_KIND,
          ],
        );
        expect(snap.rows.map((r) => r.kind).sort()).toEqual(
          [
            DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND,
            LISTEN_FINGERPRINT_SNAPSHOT_KIND,
            USER_WINDOW_SIGNALS_SNAPSHOT_KIND,
          ].sort(),
        );
      } finally {
        await worker.close();
        await analyticsEvents.close();
        await analyticsQueue.obliterate({ force: true });
        await analyticsQueue.close();
        await drainRedisPrefix(connection, prefix);
        await connection.quit();
      }
    },
  );

  it(
    "analytics queue: invalid ISO window fails the BullMQ job",
    { timeout: 60_000 },
    async () => {
      const prefix = `e2evs38:${crypto.randomUUID()}`;
      const connection = createBullMqRedisConnection(serverEnv);
      const analyticsQueue = new Queue(VS_QUEUE_NAMES.ANALYTICS, {
        connection: connection.duplicate(),
        prefix,
      });
      const analyticsEvents = new QueueEvents(VS_QUEUE_NAMES.ANALYTICS, {
        connection: connection.duplicate(),
        prefix,
      });
      const worker = new Worker(
        VS_QUEUE_NAMES.ANALYTICS,
        (job) => processAnalyticsJob(job, pool, serverEnv),
        {
          connection: connection.duplicate(),
          prefix,
          concurrency: 1,
        },
      );

      try {
        await analyticsEvents.waitUntilReady();
        await worker.waitUntilReady();

        const job = await analyticsQueue.add(ANALYTICS_QUEUE_JOB_NAME.WINDOWED_AGGREGATE, {
          windowStartIso: "not-iso",
          windowEndIso: "also-bad",
          userId: USER_ID,
        });
        await expect(job.waitUntilFinished(analyticsEvents, 45_000)).rejects.toThrow();
        expect(await job.getState()).toBe("failed");
      } finally {
        await worker.close();
        await analyticsEvents.close();
        await analyticsQueue.obliterate({ force: true });
        await analyticsQueue.close();
        await drainRedisPrefix(connection, prefix);
        await connection.quit();
      }
    },
  );
});
