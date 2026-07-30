/**
 * Median timings (PGlite + scaled listens fixture) for VS-70 listen fingerprint paths.
 *
 *   npm run bench:vs70 -w @vs/db
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { recomputeDashboardAnalyticsBundle } from "../src/dashboardAnalyticsRecompute.js";
import {
  LISTEN_FINGERPRINT_SNAPSHOT_KIND,
  parseListenFingerprintSnapshotBodyV1,
  queryListenFingerprintAggregateForUser,
} from "../src/listenFingerprintReadModel.js";
import type { DashboardAnalyticsDbExecutor } from "../src/dashboardAnalytics.js";
import { applyMigrationsToPglite } from "../src/test/applyMigrationsToPglite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARTIST_ID = "11111111-1111-4111-8111-111111111111";
const ALBUM_ID = "22222222-2222-4222-8222-222222222222";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
const NOW_MS = Date.parse("2026-04-16T12:00:00.000Z");

async function medianMs(fn: () => Promise<unknown>, runs: number): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

async function seedFixture(pglite: PGlite): Promise<void> {
  await pglite.exec("TRUNCATE TABLE users CASCADE");
  await pglite.exec("TRUNCATE TABLE tracks, albums, artists CASCADE");
  await pglite.query(
    `insert into users (id, email, password_hash)
     values ($1::uuid, 'vs70-bench@example.test', 'x')`,
    [USER_ID],
  );
  await pglite.query(
    `insert into artists (id, name, name_key)
     values ($1::uuid, 'Bench Artist', lower(regexp_replace(trim('Bench Artist'), '[[:space:]]+', ' ', 'g')))`,
    [ARTIST_ID],
  );
  await pglite.query(
    `insert into albums (id, artist_id, title, title_key)
     values ($1::uuid, $2::uuid, 'Bench Album', lower(regexp_replace(trim('Bench Album'), '[[:space:]]+', ' ', 'g')))`,
    [ALBUM_ID, ARTIST_ID],
  );
  await pglite.query(
    `insert into tracks (id, artist_id, album_id, title, title_key)
     values ($1::uuid, $2::uuid, $3::uuid, 'Bench Track', lower(regexp_replace(trim('Bench Track'), '[[:space:]]+', ' ', 'g')))`,
    [TRACK_ID, ARTIST_ID, ALBUM_ID],
  );
  await pglite.query(
    `insert into listens (user_id, track_id, played_at)
     select $1::uuid, $2::uuid,
            timestamptz '2026-04-01T00:00:00Z' + (g * interval '1 minute')
       from generate_series(1, 4000) as g`,
    [USER_ID, TRACK_ID],
  );
}

async function snapshotReadPathMs(db: DashboardAnalyticsDbExecutor): Promise<number> {
  const t0 = performance.now();
  const { rows } = await db.query<{ body: unknown }>(
    `select body from analytics_snapshots
     where user_id = $1::uuid and kind = $2`,
    [USER_ID, LISTEN_FINGERPRINT_SNAPSHOT_KIND],
  );
  const parsed = parseListenFingerprintSnapshotBodyV1(rows[0]?.body);
  if (!parsed) {
    throw new Error("bench: expected fingerprint snapshot body");
  }
  await db.query<{ x: boolean }>(
    `select exists(
       select 1 from listens l
        where l.user_id = $1::uuid
          and l.played_at > $2::timestamptz
        limit 1
     ) as x`,
    [USER_ID, parsed.as_of],
  );
  return performance.now() - t0;
}

async function main(): Promise<void> {
  const pglite = new PGlite();
  await applyMigrationsToPglite(pglite);
  await seedFixture(pglite);

  const db = pglite as unknown as DashboardAnalyticsDbExecutor;
  await recomputeDashboardAnalyticsBundle(db, { userId: USER_ID, nowMs: NOW_MS });

  const runs = 11;
  const liveAggregateMs = await medianMs(
    () => queryListenFingerprintAggregateForUser(db, USER_ID),
    runs,
  );
  const snapshotReadMs = await medianMs(() => snapshotReadPathMs(db), runs);

  const payload = {
    issue: "VS-70",
    environment: "PGlite, 4000 listens, single track (median of 11 runs)",
    recordedAt: new Date().toISOString(),
    median_ms: {
      legacy_listen_fingerprint_aggregate: liveAggregateMs,
      listen_fingerprint_v1_snapshot_select_plus_stale_exists: snapshotReadMs,
    },
    notes: [
      "legacy path matches the pre-VS-70 single statement (max + count) used on every poll.",
      "snapshot path matches production freshness: read JSON row + exists(listens.played_at > as_of).",
    ],
  };

  const outPath = path.join(__dirname, "../perf/vs70-listen-fingerprint-read-model-timings.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  await pglite.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
