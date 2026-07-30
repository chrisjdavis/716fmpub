import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  applyMigrationsToPglite,
  pgliteAsPool,
} from "@vs/db/test/pgliteHarness";
import type { ImportJobRecord } from "@vs/db";
import type { LastfmImportListenEvent } from "@vs/lastfm-provider";
import { LastfmUsernameNotFoundError, fetchLastfmRecentTrackPages } from "@vs/lastfm-provider";
import type { ServerEnv } from "@vs/env";
import { parseServerEnv } from "@vs/env";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { runQueuedLastfmImport } from "./runQueuedLastfmImport.js";

vi.mock("@vs/lastfm-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/lastfm-provider")>();
  return {
    ...actual,
    fetchLastfmRecentTrackPages: vi.fn(),
  };
});

const {
  enqueueDashboardAnalyticsAfterImportMock,
  enqueueLayer1AfterLastfmImportCompletionMock,
  enqueueLayer1AfterMeaningfulListenIngestionMock,
  notifyWebReadCacheMock,
} = vi.hoisted(() => ({
  enqueueDashboardAnalyticsAfterImportMock: vi.fn().mockResolvedValue(undefined),
  enqueueLayer1AfterLastfmImportCompletionMock: vi.fn().mockResolvedValue(undefined),
  enqueueLayer1AfterMeaningfulListenIngestionMock: vi.fn().mockResolvedValue(undefined),
  notifyWebReadCacheMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./enqueueDashboardAnalyticsAfterImport.js", () => ({
  enqueueDashboardAnalyticsAfterImport: enqueueDashboardAnalyticsAfterImportMock,
}));

vi.mock("./enqueueLayer1AfterLastfmImportCompletion.js", () => ({
  enqueueLayer1AfterLastfmImportCompletion: enqueueLayer1AfterLastfmImportCompletionMock,
}));

vi.mock("./enqueueLayer1AfterMeaningfulListenIngestion.js", () => ({
  enqueueLayer1AfterMeaningfulListenIngestion: enqueueLayer1AfterMeaningfulListenIngestionMock,
}));

vi.mock("./webReadCacheInvalidation.js", () => ({
  notifyWebAppListeningHistoryReadCacheInvalidationBestEffort: notifyWebReadCacheMock,
}));

const mockedFetch = vi.mocked(fetchLastfmRecentTrackPages);

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID_1 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbb1";
const JOB_ID_2 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbb2";

const testEnv: ServerEnv = parseServerEnv({
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/testdb",
  REDIS_URL: "redis://127.0.0.1:6379",
  EXPORT_ARTIFACTS_DIR: path.join(os.tmpdir(), "vs-worker-import-integration-artifacts"),
  LASTFM_API_KEY: "integration-test-key-not-used-against-network",
  LISTEN_SYNC_USER_MIN_INTERVAL_SEC: "120",
  LISTEN_REALTIME_PORT: "3457",
  IMPORT_LASTFM_PAGE_MIN_INTERVAL_MS: "0",
  FEATURE_FLAGS: "{}",
});

/** Stable page used for success + duplicate re-import assertions. */
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
    {
      uts: 1_714_099_500n,
      playedAt: "2026-04-14T11:55:00.000Z",
      artistName: "E2E Artist",
      albumName: "E2E Album",
      trackName: "E2E Track B",
      artistMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      albumMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
      trackMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004",
      loved: true,
      trackUrl: null,
      rawPayload: { name: "E2E Track B", loved: "1" },
    },
  ];
}

/** One older scrobble than `sampleListenPage` (oldest on that page is `1714099500`). */
function olderListenPage(): readonly LastfmImportListenEvent[] {
  return [
    {
      uts: 1_714_099_000n,
      playedAt: "2026-04-14T11:50:00.000Z",
      artistName: "E2E Artist",
      albumName: "E2E Album",
      trackName: "E2E Track C",
      artistMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      albumMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
      trackMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0005",
      loved: false,
      trackUrl: null,
      rawPayload: { name: "E2E Track C" },
    },
  ];
}

function partiallyDuplicateListenPage(): readonly LastfmImportListenEvent[] {
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
      rawPayload: { name: "E2E Track A", loved: "0" },
    },
    {
      uts: 1_714_100_000n,
      playedAt: "2026-04-14T12:00:00.000Z",
      artistName: "E2E Artist",
      albumName: "E2E Album",
      trackName: "E2E Track A",
      artistMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
      albumMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002",
      trackMbid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
      loved: true,
      trackUrl: null,
      rawPayload: { name: "E2E Track A", loved: "1" },
    },
  ];
}

function runningJob(
  id: string,
  lastfmUsername: string,
  processed = 0,
  pages = 0,
  oldest: bigint | null = null,
): ImportJobRecord {
  return {
    id,
    user_id: USER_ID,
    label: "integration",
    lastfm_username: lastfmUsername,
    source: "user",
    stage: "running",
    error_message: null,
    items_total: null,
    items_processed: processed,
    checkpoint_pages_completed: pages,
    checkpoint_oldest_uts: oldest,
    created_at: "2026-04-14T00:00:00.000Z",
    updated_at: "2026-04-14T00:00:00.000Z",
  };
}

function runningSystemSyncJob(
  id: string,
  lastfmUsername: string,
  processed = 0,
  pages = 0,
  oldest: bigint | null = null,
): ImportJobRecord {
  return { ...runningJob(id, lastfmUsername, processed, pages, oldest), source: "system_sync" };
}

describe.sequential("runQueuedLastfmImport (PGlite, mocked Last.fm provider)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    mockedFetch.mockReset();
    enqueueDashboardAnalyticsAfterImportMock.mockClear();
    enqueueLayer1AfterLastfmImportCompletionMock.mockClear();
    enqueueLayer1AfterMeaningfulListenIngestionMock.mockClear();
    notifyWebReadCacheMock.mockClear();
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'e2e-import@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
  });

  it("resumes Last.fm pagination using checkpoint_oldest_uts as toUnix", async () => {
    const page2 = olderListenPage();
    mockedFetch.mockImplementation(async function* () {
      yield page2;
    });

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username, items_processed, checkpoint_pages_completed, checkpoint_oldest_uts)
       values ($1::uuid, $2::uuid, 'e2e', 'running', 'fixture_user', 2, 1, 1714099500)`,
      [JOB_ID_1, USER_ID],
    );

    const pool = pgliteAsPool(pglite) as unknown as Pool;
    await runQueuedLastfmImport(
      pool,
      testEnv,
      runningJob(JOB_ID_1, "fixture_user", 2, 1, 1_714_099_500n),
    );

    expect(mockedFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "fixture_user",
        toUnix: 1_714_099_500,
      }),
    );

    const jobRes = await pglite.query<{
      stage: string;
      checkpoint_pages_completed: string;
      items_processed: string;
    }>(
      `select stage, checkpoint_pages_completed::text, items_processed::text from import_jobs where id = $1::uuid`,
      [JOB_ID_1],
    );
    expect(jobRes.rows[0]?.stage).toBe("completed");
    expect(jobRes.rows[0]?.checkpoint_pages_completed).toBe("2");
    expect(jobRes.rows[0]?.items_processed).toBe("3");
    expect(enqueueDashboardAnalyticsAfterImportMock).toHaveBeenCalledWith(
      testEnv,
      USER_ID,
      expect.objectContaining({ listenPeriodMetricsMode: "full" }),
    );
    expect(enqueueLayer1AfterLastfmImportCompletionMock).toHaveBeenCalledWith(
      pool,
      testEnv,
      USER_ID,
    );
    expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
    expect(notifyWebReadCacheMock).toHaveBeenCalledWith(testEnv, USER_ID);
  });

  it.each([
    { productPlan: "core" },
    { productPlan: "advanced" },
  ] as const)(
    "invokes Layer1 completion hook after successful user import (product_plan=$productPlan)",
    async ({ productPlan }) => {
      const page = sampleListenPage();
      mockedFetch.mockImplementation(async function* () {
        yield page;
      });

      await pglite.query(`update users set product_plan = $2::text where id = $1::uuid`, [
        USER_ID,
        productPlan,
      ]);

      await pglite.query(
        `insert into import_jobs (id, user_id, label, stage, lastfm_username)
         values ($1::uuid, $2::uuid, 'e2e', 'running', 'fixture_user')`,
        [JOB_ID_1, USER_ID],
      );

      const pool = pgliteAsPool(pglite) as unknown as Pool;
      await runQueuedLastfmImport(pool, testEnv, runningJob(JOB_ID_1, "fixture_user"));

      expect(enqueueLayer1AfterLastfmImportCompletionMock).toHaveBeenCalledOnce();
      expect(enqueueLayer1AfterLastfmImportCompletionMock).toHaveBeenCalledWith(
        pool,
        testEnv,
        USER_ID,
      );
      expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
    },
  );

  it("completes a successful import with canonicalized rows", async () => {
    const page = sampleListenPage();
    mockedFetch.mockImplementation(async function* () {
      yield page;
    });

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'e2e', 'running', 'fixture_user')`,
      [JOB_ID_1, USER_ID],
    );

    const pool = pgliteAsPool(pglite) as unknown as Pool;
    await runQueuedLastfmImport(pool, testEnv, runningJob(JOB_ID_1, "fixture_user"));

    const jobRes = await pglite.query<{ stage: string; error_message: string | null }>(
      `select stage, error_message from import_jobs where id = $1::uuid`,
      [JOB_ID_1],
    );
    expect(jobRes.rows[0]?.stage).toBe("completed");
    expect(jobRes.rows[0]?.error_message).toBeNull();

    const rawRes = await pglite.query<{ n: string }>(
      `select count(*)::text as n from raw_scrobbles where import_job_id = $1::uuid`,
      [JOB_ID_1],
    );
    expect(rawRes.rows[0]?.n).toBe("2");

    const canonRes = await pglite.query<{ n: string }>(
      `select count(*)::text as n from raw_scrobbles
       where import_job_id = $1::uuid and canonicalization_status = 'succeeded'`,
      [JOB_ID_1],
    );
    expect(canonRes.rows[0]?.n).toBe("2");

    expect(mockedFetch).toHaveBeenCalled();
    expect(enqueueDashboardAnalyticsAfterImportMock).toHaveBeenCalledWith(
      testEnv,
      USER_ID,
      expect.objectContaining({ listenPeriodMetricsMode: "full" }),
    );
    expect(enqueueLayer1AfterLastfmImportCompletionMock).toHaveBeenCalledWith(
      pool,
      testEnv,
      USER_ID,
    );
    expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
    expect(notifyWebReadCacheMock).toHaveBeenCalledWith(testEnv, USER_ID);
  });

  it("completes with a warning when canonicalization has row-level failures after usable imports", async () => {
    mockedFetch.mockImplementation(async function* () {
      yield partiallyDuplicateListenPage();
    });

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'partial duplicate', 'running', 'fixture_user')`,
      [JOB_ID_1, USER_ID],
    );

    const pool = pgliteAsPool(pglite) as unknown as Pool;
    await runQueuedLastfmImport(pool, testEnv, runningJob(JOB_ID_1, "fixture_user"));

    const jobRes = await pglite.query<{ stage: string; error_message: string | null }>(
      `select stage, error_message from import_jobs where id = $1::uuid`,
      [JOB_ID_1],
    );
    expect(jobRes.rows[0]?.stage).toBe("completed");
    expect(jobRes.rows[0]?.error_message).toContain("failed raw_scrobble");
    expect(jobRes.rows[0]?.error_message).toContain("Imported listens remain usable");

    const listenRes = await pglite.query<{ n: string }>(
      `select count(*)::text as n from listens where import_job_id = $1::uuid`,
      [JOB_ID_1],
    );
    expect(listenRes.rows[0]?.n).toBe("1");

    const rawStatusRes = await pglite.query<{ canonicalization_status: string; n: string }>(
      `select canonicalization_status, count(*)::text as n
       from raw_scrobbles
       where import_job_id = $1::uuid
       group by canonicalization_status
       order by canonicalization_status`,
      [JOB_ID_1],
    );
    expect(rawStatusRes.rows).toEqual([
      { canonicalization_status: "failed", n: "1" },
      { canonicalization_status: "succeeded", n: "1" },
    ]);
    expect(enqueueDashboardAnalyticsAfterImportMock).toHaveBeenCalledWith(
      testEnv,
      USER_ID,
      expect.objectContaining({ listenPeriodMetricsMode: "full" }),
    );
    expect(enqueueLayer1AfterLastfmImportCompletionMock).toHaveBeenCalledWith(
      pool,
      testEnv,
      USER_ID,
    );
    expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
    expect(notifyWebReadCacheMock).toHaveBeenCalledWith(testEnv, USER_ID);
  });

  it("dedupes on duplicate re-import (second job, identical provider page)", async () => {
    const page = sampleListenPage();
    mockedFetch.mockImplementation(async function* () {
      yield page;
    });

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'first', 'running', 'fixture_user')`,
      [JOB_ID_1, USER_ID],
    );
    const pool = pgliteAsPool(pglite) as unknown as Pool;
    await runQueuedLastfmImport(pool, testEnv, runningJob(JOB_ID_1, "fixture_user"));

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'second', 'running', 'fixture_user')`,
      [JOB_ID_2, USER_ID],
    );
    await runQueuedLastfmImport(pool, testEnv, runningJob(JOB_ID_2, "fixture_user"));

    const totalUserRows = await pglite.query<{ n: string }>(
      `select count(*)::text as n from raw_scrobbles where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(totalUserRows.rows[0]?.n).toBe("2");

    const secondJobRows = await pglite.query<{ n: string }>(
      `select count(*)::text as n from raw_scrobbles where import_job_id = $1::uuid`,
      [JOB_ID_2],
    );
    expect(secondJobRows.rows[0]?.n).toBe("0");

    const job2 = await pglite.query<{ stage: string }>(
      `select stage from import_jobs where id = $1::uuid`,
      [JOB_ID_2],
    );
    expect(job2.rows[0]?.stage).toBe("completed");
    expect(enqueueDashboardAnalyticsAfterImportMock).toHaveBeenCalledTimes(2);
    expect(enqueueLayer1AfterLastfmImportCompletionMock).toHaveBeenCalledTimes(2);
    expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
    expect(notifyWebReadCacheMock).toHaveBeenCalledTimes(2);
  });

  it("marks the job failed when the provider rejects the username", async () => {
    mockedFetch.mockImplementation(async function* () {
      throw new LastfmUsernameNotFoundError("Last.fm user not found: no_such_user");
    });

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'bad user', 'running', 'no_such_user')`,
      [JOB_ID_1, USER_ID],
    );

    const pool = pgliteAsPool(pglite) as unknown as Pool;
    await runQueuedLastfmImport(pool, testEnv, runningJob(JOB_ID_1, "no_such_user"));

    const jobRes = await pglite.query<{ stage: string; error_message: string | null }>(
      `select stage, error_message from import_jobs where id = $1::uuid`,
      [JOB_ID_1],
    );
    expect(jobRes.rows[0]?.stage).toBe("failed");
    expect(jobRes.rows[0]?.error_message).toContain("not found");
    expect(enqueueDashboardAnalyticsAfterImportMock).not.toHaveBeenCalled();
    expect(enqueueLayer1AfterLastfmImportCompletionMock).not.toHaveBeenCalled();
    expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
    expect(notifyWebReadCacheMock).toHaveBeenCalledWith(testEnv, USER_ID);
  });

  it("uses per-user Last.fm API key when worker env key is unset", async () => {
    const page = sampleListenPage();
    mockedFetch.mockImplementation(async function* () {
      yield page;
    });

    await pglite.query(
      `update users set lastfm_api_key = $2 where id = $1::uuid`,
      [USER_ID, "user-specific-lastfm-key"],
    );

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'e2e', 'running', 'fixture_user')`,
      [JOB_ID_1, USER_ID],
    );

    const pool = pgliteAsPool(pglite) as unknown as Pool;
    const envNoSharedKey: ServerEnv = { ...testEnv, LASTFM_API_KEY: undefined };
    await runQueuedLastfmImport(pool, envNoSharedKey, runningJob(JOB_ID_1, "fixture_user"));

    const jobRes = await pglite.query<{ stage: string }>(
      `select stage from import_jobs where id = $1::uuid`,
      [JOB_ID_1],
    );
    expect(jobRes.rows[0]?.stage).toBe("completed");
    expect(mockedFetch).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "user-specific-lastfm-key" }),
    );
    expect(enqueueDashboardAnalyticsAfterImportMock).toHaveBeenCalledWith(
      envNoSharedKey,
      USER_ID,
      expect.objectContaining({ listenPeriodMetricsMode: "full" }),
    );
    expect(enqueueLayer1AfterLastfmImportCompletionMock).toHaveBeenCalledWith(
      pool,
      envNoSharedKey,
      USER_ID,
    );
    expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
  });

  describe("system_sync and listen-ingested Layer 1 hook", () => {
    const SEED_ARTIST = "cccccccc-cccc-4ccc-8ccc-cccccccc0001";
    const SEED_ALBUM = "cccccccc-cccc-4ccc-8ccc-cccccccc0002";
    const SEED_TRACK = "cccccccc-cccc-4ccc-8ccc-cccccccc0003";

    beforeEach(async () => {
      await pglite.exec(
        "TRUNCATE TABLE listens, raw_scrobbles, import_jobs, tracks, albums, artists, users CASCADE",
      );
      await pglite.query(
        `insert into users (id, email, password_hash, product_plan)
         values ($1::uuid, 'e2e-sync@example.test', 'not-a-real-hash', 'advanced')`,
        [USER_ID],
      );
      await pglite.query(
        `insert into artists (id, name, musicbrainz_artist_mbid, name_key, updated_at)
         values ($1::uuid, 'Seed Artist', null, 'seed artist', now())`,
        [SEED_ARTIST],
      );
      await pglite.query(
        `insert into albums (id, artist_id, title, title_key, musicbrainz_release_mbid, updated_at)
         values ($1::uuid, $2::uuid, 'Seed Album', 'seed album', null, now())`,
        [SEED_ALBUM, SEED_ARTIST],
      );
      await pglite.query(
        `insert into tracks (id, artist_id, album_id, title, title_key, musicbrainz_recording_mbid, updated_at)
         values ($1::uuid, $2::uuid, $3::uuid, 'Seed Track', 'seed track', null, now())`,
        [SEED_TRACK, SEED_ARTIST, SEED_ALBUM],
      );
      await pglite.query(
        `insert into listens (user_id, track_id, played_at) values ($1::uuid, $2::uuid, $3::timestamptz)`,
        [USER_ID, SEED_TRACK, "2026-04-13T12:00:00.000Z"],
      );
    });

    it.each([
      { productPlan: "core" as const },
      { productPlan: "advanced" as const },
    ])(
      "after system_sync with new canonical listens, invokes meaningful Layer 1 hook (product_plan=$productPlan)",
      async ({ productPlan }) => {
        await pglite.query(`update users set product_plan = $2::text where id = $1::uuid`, [
          USER_ID,
          productPlan,
        ]);

        const page = sampleListenPage();
        mockedFetch.mockImplementation(async function* () {
          yield page;
        });

        await pglite.query(
          `insert into import_jobs (id, user_id, label, stage, lastfm_username, source)
           values ($1::uuid, $2::uuid, 'bg sync', 'running', 'fixture_user', 'system_sync')`,
          [JOB_ID_1, USER_ID],
        );

        const pool = pgliteAsPool(pglite) as unknown as Pool;
        await runQueuedLastfmImport(
          pool,
          testEnv,
          runningSystemSyncJob(JOB_ID_1, "fixture_user"),
        );

        expect(enqueueLayer1AfterLastfmImportCompletionMock).not.toHaveBeenCalled();
        expect(enqueueLayer1AfterMeaningfulListenIngestionMock).toHaveBeenCalledOnce();
        expect(enqueueLayer1AfterMeaningfulListenIngestionMock).toHaveBeenCalledWith(
          pool,
          testEnv,
          USER_ID,
          { canonicalizedNewListenRows: 2 },
        );
      },
    );

    it("system_sync with only duplicate Last.fm rows does not call meaningful Layer 1 hook", async () => {
      await pglite.query(
        `insert into import_jobs (id, user_id, label, stage, lastfm_username, source)
         values ($1::uuid, $2::uuid, 'first', 'running', 'fixture_user', 'user')`,
        [JOB_ID_1, USER_ID],
      );
      mockedFetch.mockImplementation(async function* () {
        yield sampleListenPage();
      });
      const pool = pgliteAsPool(pglite) as unknown as Pool;
      await runQueuedLastfmImport(pool, testEnv, runningJob(JOB_ID_1, "fixture_user"));

      enqueueLayer1AfterMeaningfulListenIngestionMock.mockClear();
      enqueueLayer1AfterLastfmImportCompletionMock.mockClear();

      await pglite.query(
        `insert into import_jobs (id, user_id, label, stage, lastfm_username, source)
         values ($1::uuid, $2::uuid, 'bg sync', 'running', 'fixture_user', 'system_sync')`,
        [JOB_ID_2, USER_ID],
      );
      await runQueuedLastfmImport(
        pool,
        testEnv,
        runningSystemSyncJob(JOB_ID_2, "fixture_user"),
      );

      expect(enqueueLayer1AfterMeaningfulListenIngestionMock).not.toHaveBeenCalled();
      expect(enqueueLayer1AfterLastfmImportCompletionMock).not.toHaveBeenCalled();
    });
  });
});
