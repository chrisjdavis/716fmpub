import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildHeroTimelineMonthlyAllStatementSpec,
  buildHeroWeekdayPeakStatementSpec,
} from "./dashboardHeroStatements.js";
import { buildDashboardListenSummaryStatementSpecs } from "./dashboardListenSummaryStatements.js";
import { playedAtLowerBoundUtc } from "./dashboardAnalytics.js";
import { LISTEN_SYNC_SUMMARY_FOR_USER_SQL } from "./listenSync.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARTIST_ID = "11111111-1111-4111-8111-111111111111";
const ALBUM_ID = "22222222-2222-4222-8222-222222222222";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
/** Fixed “now” so bounded dashboard ranges stay stable vs seeded `played_at`. */
const NOW_MS = Date.UTC(2026, 3, 14, 12, 0, 0);

function queryPlanLines(rows: Array<Record<string, unknown>>): string {
  return rows
    .map((row) => {
      const v = row["QUERY PLAN"] ?? row["query plan"] ?? Object.values(row)[0];
      return String(v);
    })
    .join("\n");
}

async function explainText(
  pglite: PGlite,
  sql: string,
  params: unknown[],
): Promise<string> {
  const r = await pglite.query<{ "QUERY PLAN": string }>(`explain (costs off) ${sql}`, params as never[]);
  return queryPlanLines(r.rows as Array<Record<string, unknown>>);
}

function expectNoListenSeqScan(plan: string): void {
  expect(plan).not.toMatch(/Seq Scan on listens\b/i);
  expect(plan).toMatch(/(Index|Bitmap).*listens/i);
}

describe.sequential("VS-68 query plan audit (PGlite, scaled listens fixture)", () => {
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
    await pglite.exec("TRUNCATE TABLE tracks, albums, artists CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'plan-audit@example.test', 'x')`,
      [USER_ID],
    );
    await pglite.query(
      `insert into artists (id, name, name_key)
       values ($1::uuid, 'Audit Artist', lower(regexp_replace(trim('Audit Artist'), '[[:space:]]+', ' ', 'g')))`,
      [ARTIST_ID],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key)
       values ($1::uuid, $2::uuid, 'Audit Album', lower(regexp_replace(trim('Audit Album'), '[[:space:]]+', ' ', 'g')))`,
      [ALBUM_ID, ARTIST_ID],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key)
       values ($1::uuid, $2::uuid, $3::uuid, 'Audit Track', lower(regexp_replace(trim('Audit Track'), '[[:space:]]+', ' ', 'g')))`,
      [TRACK_ID, ARTIST_ID, ALBUM_ID],
    );
    await pglite.query(
      `insert into listens (user_id, track_id, played_at)
       select $1::uuid, $2::uuid,
              timestamptz '2026-04-01T00:00:00Z' + (g * interval '1 minute')
         from generate_series(1, 4000) as g`,
      [USER_ID, TRACK_ID],
    );
    for (let i = 0; i < 20; i += 1) {
      const id = `44444444-4444-4444-8444-${String(4444 + i).padStart(12, "0")}`;
      await pglite.query(
        `insert into import_jobs (id, user_id, label, lastfm_username, stage, source)
         values ($1::uuid, $2::uuid, $3, 'u', 'completed', 'user')`,
        [id, USER_ID, `job-${i}`],
      );
    }
    await pglite.query(
      `insert into import_jobs (id, user_id, label, lastfm_username, stage, source)
       select gen_random_uuid(), $1::uuid, 'sync', 'u', 'completed', 'system_sync'
         from generate_series(1, 150) as g`,
      [USER_ID],
    );
    await pglite.query(
      `insert into import_jobs (id, user_id, label, lastfm_username, stage, source)
       values ($1::uuid, $2::uuid, 'sync', 'u', 'running', 'system_sync')`,
      ["55555555-5555-5555-8555-000000005555", USER_ID],
    );
  });

  it("stats: getDashboardListenSummary statement specs avoid seq scan on listens", async () => {
    const since = playedAtLowerBoundUtc("30d", NOW_MS);
    const specs = buildDashboardListenSummaryStatementSpecs({
      userId: USER_ID,
      since,
      untilExclusive: null,
      topLimit: 10,
    });
    expect(specs).toHaveLength(4);
    for (const spec of specs) {
      const plan = await explainText(pglite, spec.text, [...spec.values]);
      expectNoListenSeqScan(plan);
    }
  });

  it("stats: hero weekday peak (bounded window) avoids seq scan on listens", async () => {
    const since = playedAtLowerBoundUtc("30d", NOW_MS);
    if (!since) {
      throw new Error("expected bounded since");
    }
    const spec = buildHeroWeekdayPeakStatementSpec(USER_ID, since);
    const plan = await explainText(pglite, spec.text, [...spec.values]);
    expectNoListenSeqScan(plan);
  });

  it("stats: hero weekday peak with IANA calendar zone avoids seq scan on listens", async () => {
    const since = playedAtLowerBoundUtc("30d", NOW_MS);
    if (!since) {
      throw new Error("expected bounded since");
    }
    const spec = buildHeroWeekdayPeakStatementSpec(USER_ID, since, "America/Los_Angeles");
    const plan = await explainText(pglite, spec.text, [...spec.values]);
    expectNoListenSeqScan(plan);
  });

  it("stats: hero monthly timeline (all-time branch) avoids seq scan on listens", async () => {
    const spec = buildHeroTimelineMonthlyAllStatementSpec(USER_ID);
    const plan = await explainText(pglite, spec.text, [...spec.values]);
    expectNoListenSeqScan(plan);
  });

  it("stats: recent listens ordering uses an index plan on listens", async () => {
    const since = playedAtLowerBoundUtc("30d", NOW_MS);
    const plan = await explainText(
      pglite,
      `select l.id
         from listens l
        where l.user_id = $1::uuid
          and ($2::timestamptz is null or l.played_at >= $2::timestamptz)
        order by l.played_at desc, l.id desc
        limit 12`,
      [USER_ID, since],
    );
    expectNoListenSeqScan(plan);
  });

  it("archive: earliest listen uses an index plan on listens", async () => {
    const plan = await explainText(
      pglite,
      `select l.played_at
         from listens l
        where l.user_id = $1::uuid
        order by l.played_at asc, l.id asc
        limit 1`,
      [USER_ID],
    );
    expectNoListenSeqScan(plan);
  });

  it("archive: keyset page (no needle) uses an index plan on listens", async () => {
    const plan = await explainText(
      pglite,
      `select l.id
         from listens l
         join tracks t on t.id = l.track_id
         join artists ar_track on ar_track.id = t.artist_id
         left join albums al on al.id = t.album_id
         left join artists ar_album on ar_album.id = al.artist_id
         left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
         left join import_jobs ij on ij.id = l.import_job_id and ij.user_id = l.user_id
        where l.user_id = $1::uuid
          and ($2::timestamptz is null or l.played_at >= $2::timestamptz)
          and (not $3::boolean or (l.played_at, l.id) < ($4::timestamptz, $5::uuid))
          and ($6::text = 'all')
          and (length(trim(coalesce($7::text, ''))) = 0)
        order by l.played_at desc, l.id desc
        limit 40`,
      [USER_ID, null, false, null, null, "all", ""],
    );
    expectNoListenSeqScan(plan);
  });

  it("import progress: newest-first job list uses index access on import_jobs", async () => {
    const plan = await explainText(
      pglite,
      `select id
         from import_jobs
        where user_id = $1::uuid
        order by created_at desc, id desc
        limit 10`,
      [USER_ID],
    );
    expect(plan).toMatch(/import_jobs/i);
    expect(plan).not.toMatch(/Seq Scan on import_jobs\b/i);
  });

  it("import progress: job count for user uses index access on import_jobs", async () => {
    const plan = await explainText(
      pglite,
      `select count(*)::int as c from import_jobs where user_id = $1::uuid`,
      [USER_ID],
    );
    expect(plan).not.toMatch(/Seq Scan on import_jobs\b/i);
  });

  it("settings: LISTEN_SYNC_SUMMARY_FOR_USER_SQL avoids seq scan on import_jobs under many system_sync rows", async () => {
    const plan = await explainText(pglite, LISTEN_SYNC_SUMMARY_FOR_USER_SQL, [USER_ID]);
    expect(plan).not.toMatch(/Seq Scan on import_jobs\b/i);
  });

  it("settings: profile row read is a single-table users lookup by id", async () => {
    const plan = await explainText(
      pglite,
      `select display_name, lastfm_username,
              (lastfm_api_key is not null) as has_lastfm_api_key
         from users
        where id = $1::uuid
        limit 1`,
      [USER_ID],
    );
    expect(plan.toLowerCase()).toContain("on users");
    expect(plan).not.toMatch(/listens/i);
  });

  it("dashboard bundle freshness: exists(listens newer than as_of) uses index plan on listens", async () => {
    const plan = await explainText(
      pglite,
      `select exists(
         select 1 from listens l
          where l.user_id = $1::uuid
            and l.played_at > $2::timestamptz
          limit 1
       ) as x`,
      [USER_ID, new Date(NOW_MS).toISOString()],
    );
    expectNoListenSeqScan(plan);
  });

  it("export path: same archive driver shape as keyset export page (index on listens)", async () => {
    const plan = await explainText(
      pglite,
      `select l.id
         from listens l
         join tracks t on t.id = l.track_id
         join artists ar_track on ar_track.id = t.artist_id
         left join albums al on al.id = t.album_id
         left join artists ar_album on ar_album.id = al.artist_id
         left join raw_scrobbles rs on rs.id = l.raw_scrobble_id
         left join import_jobs ij on ij.id = l.import_job_id and ij.user_id = l.user_id
        where l.user_id = $1::uuid
          and ($2::timestamptz is null or l.played_at >= $2::timestamptz)
          and (not $3::boolean or (l.played_at, l.id) < ($4::timestamptz, $5::uuid))
          and ($6::text = 'all')
          and (length(trim(coalesce($7::text, ''))) = 0)
        order by l.played_at desc, l.id desc
        limit 2000`,
      [USER_ID, null, false, null, null, "all", ""],
    );
    expectNoListenSeqScan(plan);
  });
});
