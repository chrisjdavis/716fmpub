import { LAYER1_ACTIVE_SIGNAL_VERSION } from "@vs/domain";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { runLayer1EvidenceRecomputeJob } from "./layer1EvidenceRecomputeJob.js";
import { getLayer1UserRecomputeStateRow } from "./layer1UserRecomputeState.js";

const USER_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const L1_JOB_ARTIST = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0";
const L1_JOB_ALBUM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const L1_JOB_TRACK = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const L1_JOB_MBID = "6de884b6-2a32-4d25-8d2b-24081c513191";

async function seedListenForUser(
  pglite: InstanceType<typeof PGlite>,
  input: Readonly<{ userId: string; playedAtIso: string }>,
): Promise<void> {
  await pglite.query(
    `insert into artists (id, name, name_key, musicbrainz_artist_mbid)
     values ($1::uuid, 'L1 Job Artist', 'l1 job artist', $2::uuid)`,
    [L1_JOB_ARTIST, L1_JOB_MBID],
  );
  await pglite.query(
    `insert into albums (id, artist_id, title, title_key)
     values ($1::uuid, $2::uuid, 'L1 Job Album', 'l1 job album')`,
    [L1_JOB_ALBUM, L1_JOB_ARTIST],
  );
  await pglite.query(
    `insert into tracks (id, artist_id, album_id, title, title_key)
     values ($1::uuid, $2::uuid, $3::uuid, 'L1 Job Track', 'l1 job track')`,
    [L1_JOB_TRACK, L1_JOB_ARTIST, L1_JOB_ALBUM],
  );
  await pglite.query(
    `insert into listens (user_id, track_id, played_at, created_at)
     values ($1::uuid, $2::uuid, $3::timestamptz, $3::timestamptz)`,
    [input.userId, L1_JOB_TRACK, input.playedAtIso],
  );
}

describe.sequential("runLayer1EvidenceRecomputeJob (PGlite)", () => {
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
    await pglite.exec("TRUNCATE TABLE tracks CASCADE");
    await pglite.exec("TRUNCATE TABLE albums CASCADE");
    await pglite.exec("TRUNCATE TABLE artists CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash) values
         ($1::uuid, 'layer1-job-a@example.test', 'x'),
         ($2::uuid, 'layer1-job-b@example.test', 'x')`,
      [USER_A, USER_B],
    );
  });

  it("finalizes a succeeded layer1_signal_runs row for explicit users", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const result = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_A] },
      triggerKind: "test.layer1",
      enqueueReason: "import_completed",
      bullmqJobId: "test-job-1",
    });
    expect(result.runStatus).toBe("succeeded");
    expect(result.resolvedUserIds).toEqual([USER_A]);
    expect(result.totals).toEqual({
      success: 0,
      skip: 0,
      insufficiency: 0,
      failure: 0,
      usersWithHardError: 0,
    });
    expect(result.userRollups[0]).toMatchObject({
      userId: USER_A,
      userSkipped: null,
      success: 0,
      skip: 0,
      insufficiency: 0,
      failure: 0,
      userHardError: null,
    });
    const { rows } = await pglite.query<{ status: string; context_json: { enqueue_reason?: string } }>(
      `select status, context_json from layer1_signal_runs where id = $1::uuid`,
      [result.layer1SignalRunId],
    );
    expect(rows[0]?.status).toBe("succeeded");
    expect(rows[0]?.context_json?.enqueue_reason).toBe("import_completed");

    const uState = await getLayer1UserRecomputeStateRow(pool, USER_A);
    expect(uState?.status).toBe("fresh");
    expect(uState?.signalVersion).toBe(LAYER1_ACTIVE_SIGNAL_VERSION);
    expect(uState?.lastEnqueuedAt).toBeInstanceOf(Date);
    expect(uState?.lastStartedAt).toBeInstanceOf(Date);
    expect(uState?.lastSucceededAt).toBeInstanceOf(Date);
    expect(uState?.lastFailedAt).toBeNull();
    expect(uState?.failureCode).toBeNull();
    expect(uState?.failureMessage).toBeNull();
  });

  it("deduplicates explicit_user_ids while preserving first-seen order", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const result = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_B, USER_A, USER_B] },
      triggerKind: "test.layer1.dedupe",
      enqueueReason: "advanced_upgrade",
    });
    expect(result.resolvedUserIds).toEqual([USER_B, USER_A]);
    expect(result.userRollups.map((r) => r.userId)).toEqual([USER_B, USER_A]);
  });

  it("lists users for cursor batch in id order", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const r1 = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "user_cursor_batch", cursorAfterUserId: null, limit: 1 },
      triggerKind: "test.layer1.cursor",
      enqueueReason: "internal_backfill",
    });
    expect(r1.resolvedUserIds.length).toBe(1);
    const r2 = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: {
        kind: "user_cursor_batch",
        cursorAfterUserId: r1.resolvedUserIds[0] ?? null,
        limit: 10,
      },
      triggerKind: "test.layer1.cursor",
      enqueueReason: "internal_backfill",
    });
    expect(r2.resolvedUserIds.length).toBe(1);
    expect(r2.resolvedUserIds[0]).not.toBe(r1.resolvedUserIds[0]);
  });

  it("no-ops per-user materialization when input watermark and signal version are unchanged", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const first = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_A] },
      triggerKind: "test.layer1.noop.1",
      enqueueReason: "listen_ingested",
    });
    expect(first.runStatus).toBe("succeeded");
    const afterFirst = await getLayer1UserRecomputeStateRow(pool, USER_A);
    const firstSucceededAt = afterFirst?.lastSucceededAt?.getTime();
    expect(firstSucceededAt).toBeTypeOf("number");

    const second = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_A] },
      triggerKind: "test.layer1.noop.2",
      enqueueReason: "admin_manual",
    });
    expect(second.runStatus).toBe("succeeded");
    const afterSecond = await getLayer1UserRecomputeStateRow(pool, USER_A);
    expect(afterSecond?.lastSucceededAt?.getTime()).toBe(firstSucceededAt);
  });

  it("VS-90: second job run is not a no-op when canonical input watermark advances", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const first = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_A] },
      triggerKind: "test.layer1.wm.1",
      enqueueReason: "import_completed",
    });
    expect(first.runStatus).toBe("succeeded");
    const afterFirst = await getLayer1UserRecomputeStateRow(pool, USER_A);
    expect(afterFirst?.inputWatermark).toBeNull();

    const playedAtIso = "2026-04-14T18:00:00.000Z";
    await seedListenForUser(pglite, {
      userId: USER_A,
      playedAtIso,
    });

    const second = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_A] },
      triggerKind: "test.layer1.wm.2",
      enqueueReason: "listen_ingested",
    });
    expect(second.runStatus).toBe("succeeded");
    const afterSecond = await getLayer1UserRecomputeStateRow(pool, USER_A);
    expect(afterSecond?.inputWatermark?.toISOString()).toBe(playedAtIso);
  });

  it("VS-90: second job run materializes when persisted signal_version is stale", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.parse("2026-04-15T12:00:00.000Z");
    const first = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_A] },
      triggerKind: "test.layer1.sv.1",
      enqueueReason: "import_completed",
    });
    expect(first.runStatus).toBe("succeeded");
    await pglite.query(
      `update layer1_user_recompute_state
          set signal_version = $2::text
        where user_id = $1::uuid`,
      [USER_A, `${LAYER1_ACTIVE_SIGNAL_VERSION}:fixture-stale`],
    );
    const mid = await getLayer1UserRecomputeStateRow(pool, USER_A);
    expect(mid?.signalVersion).toContain("fixture-stale");

    const second = await runLayer1EvidenceRecomputeJob(pool, {
      nowMs,
      scope: { kind: "explicit_user_ids", userIds: [USER_A] },
      triggerKind: "test.layer1.sv.2",
      enqueueReason: "signal_version_changed",
    });
    expect(second.runStatus).toBe("succeeded");
    const afterSecond = await getLayer1UserRecomputeStateRow(pool, USER_A);
    expect(afterSecond?.signalVersion).toBe(LAYER1_ACTIVE_SIGNAL_VERSION);
  });
});
