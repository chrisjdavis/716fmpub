import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalizePendingRawScrobblesBatch } from "./canonicalizeRawScrobbles.js";
import { getDashboardListenSummary } from "./dashboardAnalytics.js";
import { recomputeUserListenPeriodMetrics } from "./listenPeriodMetricsRecompute.js";
import { purgeUserListenData } from "./purgeUserListenData.js";
import { batchInsertRawScrobbles } from "./rawScrobbles.js";
import {
  ANALYTICS_FIXTURE_NOW_MS,
  realisticLastfmImportRows,
} from "./test/analyticsImportFixtures.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
describe.sequential("purgeUserListenData (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.exec("TRUNCATE TABLE users CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'purge-test@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'fixture', 'completed', 'fixture_user')`,
      [JOB_ID, USER_ID],
    );
  });

  it("removes listens, import jobs (and raw rows), and analytics for the user", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into analytics_snapshots (user_id, kind, body)
       values ($1::uuid, 'test', '{}'::jsonb)`,
      [USER_ID],
    );
    await batchInsertRawScrobbles(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      rows: realisticLastfmImportRows(),
    });
    await canonicalizePendingRawScrobblesBatch(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      limit: 50,
    });
    const before = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(before.total_scrobbles).toBeGreaterThan(0);

    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "full" });
    const dailyBefore = await pglite.query<{ c: number }>(
      `select count(*)::int as c from user_listen_daily_metrics where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(dailyBefore.rows[0]?.c ?? 0).toBeGreaterThan(0);

    const lcBefore = await pglite.query<{ c: number }>(
      `select count(*)::int as c from listens where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(lcBefore.rows[0]?.c).toBeGreaterThan(0);

    await purgeUserListenData(pool, USER_ID);

    const lcAfter = await pglite.query<{ c: number }>(
      `select count(*)::int as c from listens where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(lcAfter.rows[0]?.c).toBe(0);

    const after = await getDashboardListenSummary(pool, {
      userId: USER_ID,
      range: "all",
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    expect(after.total_scrobbles).toBe(0);

    const raw = await pglite.query<{ c: number }>(
      `select count(*)::int as c from raw_scrobbles where user_id = $1`,
      [USER_ID],
    );
    expect(raw.rows[0]?.c).toBe(0);

    const jobsAfter = await pglite.query<{ c: number }>(
      `select count(*)::int as c from import_jobs where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(jobsAfter.rows[0]?.c).toBe(0);

    const dailyAfter = await pglite.query<{ c: number }>(
      `select count(*)::int as c from user_listen_daily_metrics where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(dailyAfter.rows[0]?.c).toBe(0);
  });
});
