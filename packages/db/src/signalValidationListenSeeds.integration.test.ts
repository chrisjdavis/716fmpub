import { computeListeningTemporalSignals } from "@vs/domain";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import {
  SIGNAL_VALIDATION_FIXTURE_NOW_MS,
  SIGNAL_VALIDATION_PROFILE_IDS,
  SIGNAL_VALIDATION_STATS_TIMEZONE_IANA,
  batchInsertRawImportListenRowsThenCanonicalize,
  buildSignalValidationRawImportRows,
  signalValidationSeedImportJobId,
  signalValidationSeedUserId,
} from "./test/signalValidationListenSeeds.js";

describe.sequential("signalValidationListenSeeds (PGlite)", () => {
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
  });

  for (const profileId of SIGNAL_VALIDATION_PROFILE_IDS) {
    it(`seeds profile ${profileId} through canonical listens`, async () => {
      const pool = pgliteAsPool(pglite);
      const userId = signalValidationSeedUserId(profileId);
      const jobId = signalValidationSeedImportJobId(profileId);
      await pglite.query(
        `insert into users (id, email, password_hash, stats_timezone, email_verified_at)
         values ($1::uuid, $2, 'not-a-real-hash', $3, now())`,
        [userId, `vs54+${profileId}@seed.716fm.test`, SIGNAL_VALIDATION_STATS_TIMEZONE_IANA],
      );
      await pglite.query(
        `insert into import_jobs (id, user_id, label, stage, lastfm_username)
         values ($1::uuid, $2::uuid, 'vs54_signal_validation', 'running', 'fixture_user')`,
        [jobId, userId],
      );

      const out = await batchInsertRawImportListenRowsThenCanonicalize(pool, {
        userId,
        importJobId: jobId,
        profileId,
        nowMs: SIGNAL_VALIDATION_FIXTURE_NOW_MS,
      });
      expect(out.rowCount).toBeGreaterThan(0);
      expect(out.inserted).toBe(out.rowCount);
      expect(out.skippedDuplicates).toBe(0);
      expect(out.canonicalized).toEqual({
        examined: out.rowCount,
        succeeded: out.rowCount,
        failed: 0,
      });

      const { rows: lr } = await pglite.query<{ c: number }>(
        `select count(*)::int as c from listens where user_id = $1::uuid`,
        [userId],
      );
      expect(lr[0]?.c).toBe(out.rowCount);
    });
  }

  it("rich_long_term: temporal signals show streak, burst, and multi-month span", async () => {
    const pool = pgliteAsPool(pglite);
    const userId = signalValidationSeedUserId("rich_long_term");
    const jobId = signalValidationSeedImportJobId("rich_long_term");
    await pglite.query(
      `insert into users (id, email, password_hash, stats_timezone, email_verified_at)
       values ($1::uuid, $2, 'not-a-real-hash', $3, now())`,
      [userId, "vs54+rich_long_term@seed.716fm.test", SIGNAL_VALIDATION_STATS_TIMEZONE_IANA],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'vs54_signal_validation', 'running', 'fixture_user')`,
      [jobId, userId],
    );
    await batchInsertRawImportListenRowsThenCanonicalize(pool, {
      userId,
      importJobId: jobId,
      profileId: "rich_long_term",
      nowMs: SIGNAL_VALIDATION_FIXTURE_NOW_MS,
    });

    const { rows: plays } = await pglite.query<{ played_at: string }>(
      `select played_at from listens where user_id = $1::uuid order by played_at asc`,
      [userId],
    );
    const playedAtMs = plays.map((p) => new Date(p.played_at).getTime());
    const temporal = computeListeningTemporalSignals({
      playedAtMs,
      statsTimezoneIana: SIGNAL_VALIDATION_STATS_TIMEZONE_IANA,
    });
    expect(temporal.total_play_count).toBe(playedAtMs.length);
    expect(
      temporal.first_listen_at_ms !== null &&
        SIGNAL_VALIDATION_FIXTURE_NOW_MS - temporal.first_listen_at_ms >
          200 * 86_400_000,
    ).toBe(true);
    expect(temporal.longest_streak_length_days).toBeGreaterThanOrEqual(10);
    expect(temporal.burst_windows.length).toBeGreaterThanOrEqual(1);
    expect(temporal.burst_windows.some((b) => b.play_count >= 4)).toBe(true);
  });

  it("exploratory_listener: many distinct tracks in the fixture window", async () => {
    const pool = pgliteAsPool(pglite);
    const userId = signalValidationSeedUserId("exploratory_listener");
    const jobId = signalValidationSeedImportJobId("exploratory_listener");
    await pglite.query(
      `insert into users (id, email, password_hash, stats_timezone, email_verified_at)
       values ($1::uuid, $2, 'not-a-real-hash', $3, now())`,
      [userId, "vs54+exploratory_listener@seed.716fm.test", SIGNAL_VALIDATION_STATS_TIMEZONE_IANA],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'vs54_signal_validation', 'running', 'fixture_user')`,
      [jobId, userId],
    );
    await batchInsertRawImportListenRowsThenCanonicalize(pool, {
      userId,
      importJobId: jobId,
      profileId: "exploratory_listener",
      nowMs: SIGNAL_VALIDATION_FIXTURE_NOW_MS,
    });

    const windowStart = SIGNAL_VALIDATION_FIXTURE_NOW_MS - 32 * 86_400_000;
    const { rows } = await pglite.query<{ d: number; p: number }>(
      `select
         count(distinct l.track_id)::int as d,
         count(*)::int as p
       from listens l
       where l.user_id = $1::uuid
         and l.played_at >= $2::timestamptz
         and l.played_at < $3::timestamptz`,
      [userId, new Date(windowStart).toISOString(), new Date(SIGNAL_VALIDATION_FIXTURE_NOW_MS).toISOString()],
    );
    const d = rows[0]?.d ?? 0;
    const p = rows[0]?.p ?? 0;
    expect(p).toBeGreaterThanOrEqual(40);
    expect(d).toBeGreaterThanOrEqual(35);
    expect(d / p).toBeGreaterThan(0.75);
  });

  it("sparse_partial_importer: low play count with wide calendar spread", async () => {
    const rows = buildSignalValidationRawImportRows("sparse_partial_importer", {
      nowMs: SIGNAL_VALIDATION_FIXTURE_NOW_MS,
    });
    expect(rows.length).toBeLessThanOrEqual(12);
    const pool = pgliteAsPool(pglite);
    const userId = signalValidationSeedUserId("sparse_partial_importer");
    const jobId = signalValidationSeedImportJobId("sparse_partial_importer");
    await pglite.query(
      `insert into users (id, email, password_hash, stats_timezone, email_verified_at)
       values ($1::uuid, $2, 'not-a-real-hash', $3, now())`,
      [userId, "vs54+sparse_partial_importer@seed.716fm.test", SIGNAL_VALIDATION_STATS_TIMEZONE_IANA],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username)
       values ($1::uuid, $2::uuid, 'vs54_signal_validation', 'running', 'fixture_user')`,
      [jobId, userId],
    );
    await batchInsertRawImportListenRowsThenCanonicalize(pool, {
      importJobId: jobId,
      userId,
      profileId: "sparse_partial_importer",
      nowMs: SIGNAL_VALIDATION_FIXTURE_NOW_MS,
    });
    const { rows: plays } = await pglite.query<{ played_at: string }>(
      `select played_at from listens where user_id = $1::uuid order by played_at asc`,
      [userId],
    );
    const playedAtMs = plays.map((p) => new Date(p.played_at).getTime());
    const temporal = computeListeningTemporalSignals({
      playedAtMs,
      statsTimezoneIana: SIGNAL_VALIDATION_STATS_TIMEZONE_IANA,
    });
    expect(temporal.total_play_count).toBeLessThanOrEqual(12);
    expect(temporal.active_local_day_count).toBeGreaterThanOrEqual(plays.length);
  });
});
