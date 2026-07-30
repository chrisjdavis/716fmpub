import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizePendingRawScrobblesBatch } from "./canonicalizeRawScrobbles.js";
import { batchInsertRawScrobbles } from "./rawScrobbles.js";
import {
  ANALYTICS_FIXTURE_NOW_MS,
  realisticLastfmImportRows,
} from "./test/analyticsImportFixtures.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { getListenFingerprintForUser } from "./listenSync.js";
import { LISTEN_FINGERPRINT_SNAPSHOT_KIND } from "./listenFingerprintReadModel.js";
import { ARTIST_USER_RELATIONSHIP_SIGNAL_KIND } from "@vs/domain";
import {
  DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND,
  recomputeDashboardAnalyticsBundle,
  resolveDashboardAnalyticsBundleRead,
  tryReadFreshDashboardAnalyticsBundle,
} from "./dashboardAnalyticsRecompute.js";
import { runLayer1EvidenceRecomputeJob } from "./layer1EvidenceRecomputeJob.js";
import {
  parseUserWindowSignalsSnapshotBodyV1,
  USER_WINDOW_SIGNALS_SNAPSHOT_KIND,
} from "./userWindowSignalsRecompute.js";
import { recomputeUserListenPeriodMetrics } from "./listenPeriodMetricsRecompute.js";
import { backfillUserListenDailyMetricsFromListens } from "./userListenDailyMetricsRecompute.js";
import { getUserListenStatsFoundationReadiness } from "./userListenStatsFoundationReadiness.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

describe.sequential("dashboardAnalyticsRecompute (PGlite)", () => {
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
       values ($1::uuid, 'recompute@example.test', 'not-a-real-hash')`,
      [USER_ID],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'fixture_user', 'running', 'fixture_user')`,
      [JOB_ID, USER_ID],
    );
    const pool = pgliteAsPool(pglite);
    const insert = await batchInsertRawScrobbles(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      rows: realisticLastfmImportRows(),
    });
    expect(insert.inserted).toBe(4);
    const canon = await canonicalizePendingRawScrobblesBatch(pool, {
      importJobId: JOB_ID,
      userId: USER_ID,
      limit: 50,
    });
    expect(canon).toEqual({ examined: 4, succeeded: 4, failed: 0 });
  });

  it("getUserListenStatsFoundationReadiness is false before rollups and true after recompute", async () => {
    const pool = pgliteAsPool(pglite);
    let r = await getUserListenStatsFoundationReadiness(pool, USER_ID);
    expect(r.hasListens).toBe(true);
    expect(r.periodRollupsPopulated).toBe(false);
    expect(r.artistRollupsPopulated).toBe(false);
    expect(r.dailyMetricsPopulated).toBe(false);
    await recomputeUserListenPeriodMetrics(pool, USER_ID);
    r = await getUserListenStatsFoundationReadiness(pool, USER_ID);
    expect(r.periodRollupsPopulated).toBe(true);
    expect(r.artistRollupsPopulated).toBe(true);
    expect(r.dailyMetricsPopulated).toBe(true);
  });

  it("getUserListenStatsFoundationReadiness is false when daily metrics missing but older rollups exist", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "full" });
    await pglite.query(`delete from user_listen_daily_metrics where user_id = $1::uuid`, [
      USER_ID,
    ]);
    const r = await getUserListenStatsFoundationReadiness(pool, USER_ID);
    expect(r.hasListens).toBe(true);
    expect(r.periodRollupsPopulated).toBe(true);
    expect(r.artistRollupsPopulated).toBe(true);
    expect(r.dailyMetricsPopulated).toBe(false);
  });

  it("backfillUserListenDailyMetricsFromListens repopulates user_listen_daily_metrics", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "full" });
    await pglite.query(`delete from user_listen_daily_metrics where user_id = $1::uuid`, [
      USER_ID,
    ]);
    await backfillUserListenDailyMetricsFromListens(pool, USER_ID);
    const { rows: d } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_listen_daily_metrics where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(Number(d[0]?.c ?? 0)).toBeGreaterThan(0);
  });

  it("recomputes calendar week/month/year metrics and artist stats from fixture listens", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeUserListenPeriodMetrics(pool, USER_ID);
    const { rows: m } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_listen_period_metrics where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(Number(m[0]?.c ?? 0)).toBeGreaterThan(0);
    const { rows: a } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_artist_listen_stats where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(Number(a[0]?.c ?? 0)).toBeGreaterThan(0);
    const { rows: d } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_listen_daily_metrics where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(Number(d[0]?.c ?? 0)).toBeGreaterThan(0);
  });

  it("incremental refresh replaces only current UTC week/month/year rows, not other buckets", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "full" });

    await pglite.query(
      `update user_listen_period_metrics
          set play_count = 55555
        where user_id = $1::uuid
          and period_kind = 'calendar_week'
          and period_start <> date_trunc('week', now() at time zone 'UTC')::date`,
      [USER_ID],
    );

    await pglite.query(
      `update user_listen_period_metrics
          set play_count = 99999
        where user_id = $1::uuid
          and period_kind = 'calendar_week'
          and period_start = date_trunc('week', now() at time zone 'UTC')::date`,
      [USER_ID],
    );

    await pglite.query(
      `update user_listen_period_metrics
          set play_count = 88888
        where user_id = $1::uuid
          and period_kind = 'calendar_month'
          and period_start = date_trunc('month', now() at time zone 'UTC')::date`,
      [USER_ID],
    );

    await pglite.query(
      `update user_listen_period_metrics
          set play_count = 77777
        where user_id = $1::uuid
          and period_kind = 'calendar_year'
          and period_start = date_trunc('year', now() at time zone 'UTC')::date`,
      [USER_ID],
    );

    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "incremental" });

    const { rows: staleOtherWeeks } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_listen_period_metrics
        where user_id = $1::uuid
          and period_kind = 'calendar_week'
          and play_count = 55555`,
      [USER_ID],
    );
    expect(Number(staleOtherWeeks[0]?.c ?? 0)).toBeGreaterThan(0);

    const { rows: weekCur } = await pglite.query<{ play_count: number }>(
      `select play_count from user_listen_period_metrics
        where user_id = $1::uuid
          and period_kind = 'calendar_week'
          and period_start = date_trunc('week', now() at time zone 'UTC')::date`,
      [USER_ID],
    );
    expect(weekCur).toHaveLength(1);
    expect(weekCur[0]!.play_count).not.toBe(99999);

    const { rows: monthCur } = await pglite.query<{ play_count: number }>(
      `select play_count from user_listen_period_metrics
        where user_id = $1::uuid
          and period_kind = 'calendar_month'
          and period_start = date_trunc('month', now() at time zone 'UTC')::date`,
      [USER_ID],
    );
    expect(monthCur).toHaveLength(1);
    expect(monthCur[0]!.play_count).not.toBe(88888);

    const { rows: yearCur } = await pglite.query<{ play_count: number }>(
      `select play_count from user_listen_period_metrics
        where user_id = $1::uuid
          and period_kind = 'calendar_year'
          and period_start = date_trunc('year', now() at time zone 'UTC')::date`,
      [USER_ID],
    );
    expect(yearCur).toHaveLength(1);
    expect(yearCur[0]!.play_count).not.toBe(77777);
    expect(yearCur[0]!.play_count).toBe(4);
  });

  it("incremental bootstraps a full rollup when no period rows exist yet", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(`delete from user_listen_period_metrics where user_id = $1::uuid`, [
      USER_ID,
    ]);
    await pglite.query(`delete from user_artist_listen_stats where user_id = $1::uuid`, [
      USER_ID,
    ]);

    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "incremental" });

    const { rows: m } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_listen_period_metrics where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(Number(m[0]?.c ?? 0)).toBeGreaterThan(1);
  });

  it("incremental upgrades to full when listens span more UTC months than calendar_month rollups", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "full" });
    const { rows: before } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_listen_period_metrics
        where user_id = $1::uuid and period_kind = 'calendar_month' and play_count > 0`,
      [USER_ID],
    );
    expect(Number(before[0]?.c ?? 0)).toBeGreaterThan(0);

    await pglite.query(
      `delete from user_listen_period_metrics
        where user_id = $1::uuid and period_kind = 'calendar_month'`,
      [USER_ID],
    );

    await recomputeUserListenPeriodMetrics(pool, USER_ID, { mode: "incremental" });

    const { rows: after } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from user_listen_period_metrics
        where user_id = $1::uuid and period_kind = 'calendar_month' and play_count > 0`,
      [USER_ID],
    );
    expect(Number(after[0]?.c ?? 0)).toBeGreaterThan(0);
  });

  it("upserts an idempotent dashboard bundle snapshot", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeDashboardAnalyticsBundle(pool, {
      userId: USER_ID,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    await recomputeDashboardAnalyticsBundle(pool, {
      userId: USER_ID,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    await runLayer1EvidenceRecomputeJob(pool, {
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
      scope: { kind: "explicit_user_ids", userIds: [USER_ID] },
      triggerKind: "test.dashboard_analytics_recompute.integration",
      enqueueReason: "listen_ingested",
    });

    const { rows } = await pglite.query<{ body: { ranges?: unknown } }>(
      `select body from analytics_snapshots
       where user_id = $1::uuid and kind = $2`,
      [USER_ID, DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body?.ranges).toBeTruthy();

    const { rows: fpRows } = await pglite.query<{ kind: string }>(
      `select kind from analytics_snapshots where user_id = $1::uuid order by kind`,
      [USER_ID],
    );
    expect(fpRows.map((r) => r.kind).sort()).toEqual(
      [
        DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND,
        LISTEN_FINGERPRINT_SNAPSHOT_KIND,
        USER_WINDOW_SIGNALS_SNAPSHOT_KIND,
      ].sort(),
    );

    const { rows: wsRows } = await pglite.query<{ body: unknown }>(
      `select body from analytics_snapshots
       where user_id = $1::uuid and kind = $2`,
      [USER_ID, USER_WINDOW_SIGNALS_SNAPSHOT_KIND],
    );
    expect(wsRows).toHaveLength(1);
    const ws = parseUserWindowSignalsSnapshotBodyV1(wsRows[0]?.body);
    expect(ws).not.toBeNull();
    expect(ws!.ranges["7d"].play_count).toBeGreaterThan(0);
    expect(ws!.ranges["7d"].weekday_distribution).toHaveLength(7);

    const { rows: layer1 } = await pglite.query<{ c: string }>(
      `select count(*)::text as c from layer1_evidence_objects
        where user_id = $1::uuid and signal_kind = $2`,
      [USER_ID, ARTIST_USER_RELATIONSHIP_SIGNAL_KIND],
    );
    expect(Number(layer1[0]?.c ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it("getListenFingerprintForUser prefers fresh listen_fingerprint_v1", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeDashboardAnalyticsBundle(pool, {
      userId: USER_ID,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    const fp = await getListenFingerprintForUser(pool, USER_ID);
    expect(fp.fingerprint_read_model).toBe("snapshot_fresh");
    expect(fp.listen_count).toBe("4");
    expect(fp.max_played_at).toMatch(/^\d{4}-/);
    expect(fp.ingest_raw_rows).toBe("4");
    expect(fp.import_job_touch).toEqual(expect.any(String));
  });

  it("getListenFingerprintForUser falls back when snapshot is count-stale but new rows are older than as_of", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeDashboardAnalyticsBundle(pool, {
      userId: USER_ID,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    await pglite.query(
      `insert into listens (user_id, track_id, played_at, import_job_id)
       select user_id, track_id, '1999-06-15T12:00:00.000Z'::timestamptz, import_job_id
       from listens where user_id = $1::uuid limit 1`,
      [USER_ID],
    );
    const fp = await getListenFingerprintForUser(pool, USER_ID);
    expect(fp.fingerprint_read_model).toBe("canonical_listens");
    expect(fp.listen_count).toBe("5");
    expect(fp.ingest_raw_rows).toBe("4");
    expect(fp.import_job_touch).toEqual(expect.any(String));
  });

  it("getListenFingerprintForUser falls back to canonical_listens when snapshot is stale", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeDashboardAnalyticsBundle(pool, {
      userId: USER_ID,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    await pglite.query(
      `update listens l
         set played_at = '2030-01-01T00:00:00.000Z'
        from (select id from listens where user_id = $1::uuid order by played_at desc limit 1) s
       where l.id = s.id`,
      [USER_ID],
    );
    const fp = await getListenFingerprintForUser(pool, USER_ID);
    expect(fp.fingerprint_read_model).toBe("canonical_listens");
    expect(fp.max_played_at).toBe("2030-01-01T00:00:00.000Z");
    expect(fp.ingest_raw_rows).toBe("4");
    expect(fp.import_job_touch).toEqual(expect.any(String));
  });

  it("getListenFingerprintForUser falls back when fingerprint snapshot body is invalid", async () => {
    const pool = pgliteAsPool(pglite);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await pglite.query(
      `insert into analytics_snapshots (user_id, kind, body)
       values ($1::uuid, $2, $3::jsonb)
       on conflict (user_id, kind) do update set body = excluded.body`,
      [USER_ID, LISTEN_FINGERPRINT_SNAPSHOT_KIND, JSON.stringify({ bad: true })],
    );
    const fp = await getListenFingerprintForUser(pool, USER_ID);
    expect(fp.fingerprint_read_model).toBe("canonical_listens");
    expect(fp.listen_count).toBe("4");
    expect(fp.ingest_raw_rows).toBe("4");
    expect(fp.import_job_touch).toEqual(expect.any(String));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("tryReadFreshDashboardAnalyticsBundle returns data until listens move past as_of", async () => {
    const pool = pgliteAsPool(pglite);
    await recomputeDashboardAnalyticsBundle(pool, {
      userId: USER_ID,
      nowMs: ANALYTICS_FIXTURE_NOW_MS,
    });
    const fresh = await tryReadFreshDashboardAnalyticsBundle(pool, USER_ID);
    expect(fresh).not.toBeNull();
    expect(fresh?.ranges["30d"].summary.total_scrobbles).toBe(4);

    await pglite.query(
      `update listens l
         set played_at = '2030-01-01T00:00:00.000Z'
        from (select id from listens where user_id = $1::uuid order by played_at desc limit 1) s
       where l.id = s.id`,
      [USER_ID],
    );

    const stale = await tryReadFreshDashboardAnalyticsBundle(pool, USER_ID);
    expect(stale).toBeNull();

    const resolved = await resolveDashboardAnalyticsBundleRead(pool, USER_ID);
    expect(resolved.status).toBe("stale");
    if (resolved.status === "stale") {
      expect(resolved.snapshot_as_of).toMatch(/^\d{4}-/);
      expect(resolved.bundle.as_of).toBe(resolved.snapshot_as_of);
      expect(resolved.bundle.archive_totals.allTimeScrobbles).toBeGreaterThan(0);
    }
  });

  it("resolveDashboardAnalyticsBundleRead reports missing without a snapshot row", async () => {
    const pool = pgliteAsPool(pglite);
    const missingUser = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'no-snapshot@example.test', 'not-a-real-hash')`,
      [missingUser],
    );
    const r = await resolveDashboardAnalyticsBundleRead(pool, missingUser);
    expect(r).toEqual({ status: "missing" });
  });

  it("resolveDashboardAnalyticsBundleRead reports invalid_body and logs", async () => {
    const pool = pgliteAsPool(pglite);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await pglite.query(
      `insert into analytics_snapshots (user_id, kind, body)
       values ($1::uuid, $2, $3::jsonb)
       on conflict (user_id, kind) do update set body = excluded.body`,
      [USER_ID, DASHBOARD_ANALYTICS_BUNDLE_SNAPSHOT_KIND, JSON.stringify({ not_schema: true })],
    );
    const r = await resolveDashboardAnalyticsBundleRead(pool, USER_ID);
    expect(r).toEqual({ status: "invalid_body" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
