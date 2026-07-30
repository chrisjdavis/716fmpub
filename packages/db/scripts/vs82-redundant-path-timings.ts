/**
 * Median timings (PGlite + scaled listens fixture) for VS-82 consolidated paths:
 * shared listen fingerprint aggregate SQL + archive page row materialization.
 *
 *   npm run bench:vs82 -w @vs/db
 */
import { PGlite } from "@electric-sql/pglite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  getArchiveListensPage,
  type DashboardAnalyticsDbExecutor,
} from "../src/dashboardAnalytics.js";
import { queryListenFingerprintAggregateForUser } from "../src/listenFingerprintReadModel.js";
import { applyMigrationsToPglite } from "../src/test/applyMigrationsToPglite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ARTIST_ID = "11111111-1111-4111-8111-111111111111";
const ALBUM_ID = "22222222-2222-4222-8222-222222222222";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";

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
     values ($1::uuid, 'vs82-bench@example.test', 'x')`,
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

async function main(): Promise<void> {
  const pglite = new PGlite();
  await applyMigrationsToPglite(pglite);
  await seedFixture(pglite);

  const runs = 11;
  const db = pglite as unknown as DashboardAnalyticsDbExecutor;

  const fingerprintAggregateMs = await medianMs(
    () => queryListenFingerprintAggregateForUser(db, USER_ID),
    runs,
  );
  const archiveListensPageMs = await medianMs(
    () =>
      getArchiveListensPage(db, {
        userId: USER_ID,
        range: "all",
        limit: 40,
        cursor: null,
        q: null,
        source: "all",
        type: "tracks",
      }),
    runs,
  );

  const payload = {
    issue: "VS-82",
    environment: "PGlite, 4000 listens, single track (median of 11 runs)",
    recordedAt: new Date().toISOString(),
    measurement_contract: {
      intent: "Regression harness for two hot server paths after VS-82 consolidation.",
      not_claimed:
        "Fingerprint SQL dedupe removes duplicate source code, not an extra round-trip per API call; expect similar median_ms to pre-change for that query alone.",
      compare_to:
        "packages/db/perf/vs82-redundant-path-timings.json on the same host class when changing dashboard archive reads or fingerprint aggregates.",
    },
    median_ms: {
      listen_fingerprint_aggregate_for_user: fingerprintAggregateMs,
      archive_listens_first_viewport_page: archiveListensPageMs,
    },
    notes: [
      "listen_fingerprint_aggregate_for_user is the single shared SQL path used by dashboard recompute and live listen fingerprint reads.",
      "archive_listens_first_viewport_page maps each row through shared pg timestamptz coercion (server-side contract for played_at).",
      "Full audit backlog and scope framing: docs/performance/vs-82-duplication-audit-inventory.md.",
    ],
  };

  const outPath = path.join(__dirname, "../perf/vs82-redundant-path-timings.json");
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  await pglite.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
