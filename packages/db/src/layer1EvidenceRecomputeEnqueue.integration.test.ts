import { LAYER1_ACTIVE_SIGNAL_VERSION } from "@vs/domain";
import { LAYER1_EVIDENCE_RECOMPUTE_ENQUEUE_REASON_CODES } from "@vs/queue";
import { PGlite } from "@electric-sql/pglite";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { enqueueLayer1EvidenceRecomputeForUser } from "./layer1EvidenceRecomputeEnqueue.js";
import { getLayer1UserRecomputeStateRow, queryLayer1InputWatermarkForUser } from "./layer1UserRecomputeState.js";

const USER_ADV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const USER_ADV_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_CORE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** Minimal catalog row for `listens.track_id` FK in VS-90 watermark integration cases. */
const VS90_ARTIST = "11111111-1111-4111-8111-111111111111";
const VS90_ALBUM = "22222222-2222-4222-8222-222222222222";
const VS90_TRACK = "33333333-3333-4333-8333-333333333333";
const VS90_ARTIST_MBID = "6de884b6-2a32-4d25-8d2b-24081c513191";

async function seedVs90TrackAndListen(
  pglite: InstanceType<typeof PGlite>,
  input: Readonly<{ userId: string; playedAtIso: string }>,
): Promise<void> {
  await pglite.query(
    `insert into artists (id, name, name_key, musicbrainz_artist_mbid)
     values ($1::uuid, 'VS-90 Artist', 'vs90 artist', $2::uuid)`,
    [VS90_ARTIST, VS90_ARTIST_MBID],
  );
  await pglite.query(
    `insert into albums (id, artist_id, title, title_key)
     values ($1::uuid, $2::uuid, 'VS-90 Album', 'vs90 album')`,
    [VS90_ALBUM, VS90_ARTIST],
  );
  await pglite.query(
    `insert into tracks (id, artist_id, album_id, title, title_key)
     values ($1::uuid, $2::uuid, $3::uuid, 'VS-90 Track', 'vs90 track')`,
    [VS90_TRACK, VS90_ARTIST, VS90_ALBUM],
  );
  await pglite.query(
    `insert into listens (user_id, track_id, played_at, created_at)
     values ($1::uuid, $2::uuid, $3::timestamptz, $3::timestamptz)`,
    [input.userId, VS90_TRACK, input.playedAtIso],
  );
}

function createMockQueue(): { queue: Queue; addMock: ReturnType<typeof vi.fn> } {
  const addMock = vi.fn().mockResolvedValue({ id: "jq-1" });
  const queue = { add: addMock } as unknown as Queue;
  return { queue, addMock };
}

describe.sequential("enqueueLayer1EvidenceRecomputeForUser (PGlite)", () => {
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
    // `users` CASCADE removes listens but not catalog rows; VS-90 seeds reuse fixed artist/track ids.
    await pglite.exec("TRUNCATE TABLE tracks CASCADE");
    await pglite.exec("TRUNCATE TABLE albums CASCADE");
    await pglite.exec("TRUNCATE TABLE artists CASCADE");
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan) values
         ($1::uuid, 'layer1-enq-adv@example.test', 'x', 'advanced'),
         ($2::uuid, 'layer1-enq-core@example.test', 'x', 'core')`,
      [USER_ADV, USER_CORE],
    );
  });

  it("enqueues for Core without override (OSS: Advanced unlocked)", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_CORE,
      reason: "listen_ingested",
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_CORE,
      reason: "listen_ingested",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("enqueues for Core with import_completed reason (OSS: Advanced unlocked)", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_CORE,
      reason: "import_completed",
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_CORE,
      reason: "import_completed",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("enqueues for Advanced when work is needed", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "advanced_upgrade",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_ADV,
      reason: "advanced_upgrade",
    });
    expect(out).not.toHaveProperty("internalEntitlementOverrideApplied");
    expect(addMock).toHaveBeenCalledTimes(1);
    const [name, data, opts] = addMock.mock.calls[0] as [
      string,
      { scope: { kind: string; userIds: string[] }; enqueueReason: string },
      { jobId?: string },
    ];
    expect(name).toBe("layer1_evidence_recompute");
    expect(data.scope).toEqual({ kind: "explicit_user_ids", userIds: [USER_ADV] });
    expect(data.enqueueReason).toBe("advanced_upgrade");
    expect(opts.jobId).toBe(`layer1-evidence-${USER_ADV}`);
  });

  it("enqueues for Advanced with listen_ingested when work is needed", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "listen_ingested",
      now: new Date("2026-04-15T12:00:00.000Z"),
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_ADV,
      reason: "listen_ingested",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, data] = addMock.mock.calls[0] as [string, { enqueueReason: string }];
    expect(data.enqueueReason).toBe("listen_ingested");
  });

  it("forces stable jobId when jobsOptions attempts a different jobId", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "signal_version_changed",
      jobsOptions: { jobId: "custom-should-not-win" },
    });
    const [, , opts] = addMock.mock.calls[0] as [string, unknown, { jobId?: string }];
    expect(opts.jobId).toBe(`layer1-evidence-${USER_ADV}`);
  });

  it("issues the same BullMQ jobId on repeated enqueue for the same user", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const reason = "listen_ingested" as const;
    await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason,
    });
    await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason,
    });
    expect(addMock).toHaveBeenCalledTimes(2);
    const id0 = (addMock.mock.calls[0]?.[2] as { jobId?: string })?.jobId;
    const id1 = (addMock.mock.calls[1]?.[2] as { jobId?: string })?.jobId;
    expect(id0).toBe(`layer1-evidence-${USER_ADV}`);
    expect(id1).toBe(id0);
  });

  it("allows Core when internalEntitlementOverride is set", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_CORE,
      reason: "admin_manual",
      internalEntitlementOverride: true,
    });
    expect(out).toMatchObject({
      outcome: "enqueued",
      internalEntitlementOverrideApplied: true,
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const [, adminData] = addMock.mock.calls[0] as [string, { enqueueReason: string }];
    expect(adminData.enqueueReason).toBe("admin_manual");
  });

  it("returns skipped_user_not_found for unknown user id", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    const missing = "99999999-9999-4999-8999-999999999999";
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: missing,
      reason: "import_completed",
    });
    expect(out).toEqual({
      outcome: "skipped_user_not_found",
      userId: missing,
      reason: "import_completed",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("returns skipped_already_fresh without publishing", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark, last_succeeded_at
       ) values ($1::uuid, 'fresh', $2::text, null, now())`,
      [USER_ADV, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "nightly_reconciliation",
    });
    expect(out).toEqual({
      outcome: "skipped_already_fresh",
      userId: USER_ADV,
      reason: "nightly_reconciliation",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("VS-90: duplicate enqueue attempts are idempotent when already fresh (no queue publish)", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark, last_succeeded_at
       ) values ($1::uuid, 'fresh', $2::text, null, now())`,
      [USER_ADV, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    const { queue, addMock } = createMockQueue();
    const reason = "listen_ingested" as const;
    const first = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason,
    });
    const second = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason,
    });
    expect(first).toEqual({
      outcome: "skipped_already_fresh",
      userId: USER_ADV,
      reason,
    });
    expect(second).toEqual(first);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("VS-90: skipped_already_fresh when signal version and non-null input watermark match canonical frontier", async () => {
    const pool = pgliteAsPool(pglite);
    const playedAt = "2026-04-10T15:30:00.000Z";
    await seedVs90TrackAndListen(pglite, { userId: USER_ADV, playedAtIso: playedAt });
    const wm = await queryLayer1InputWatermarkForUser(pool, USER_ADV);
    expect(wm?.toISOString()).toBe(playedAt);
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark, last_succeeded_at
       ) values ($1::uuid, 'fresh', $2::text, $3::timestamptz, now())`,
      [USER_ADV, LAYER1_ACTIVE_SIGNAL_VERSION, playedAt],
    );
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "nightly_reconciliation",
    });
    expect(out).toEqual({
      outcome: "skipped_already_fresh",
      userId: USER_ADV,
      reason: "nightly_reconciliation",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("VS-90: enqueues when persisted signal_version is stale vs active constant", async () => {
    const pool = pgliteAsPool(pglite);
    const playedAt = "2026-04-10T12:00:00.000Z";
    await seedVs90TrackAndListen(pglite, { userId: USER_ADV, playedAtIso: playedAt });
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark, last_succeeded_at
       ) values ($1::uuid, 'fresh', $2::text, $3::timestamptz, now())`,
      [USER_ADV, `${LAYER1_ACTIVE_SIGNAL_VERSION}:pre-bump`, playedAt],
    );
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "signal_version_changed",
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_ADV,
      reason: "signal_version_changed",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("VS-90: enqueues when canonical input watermark advances beyond stored input_watermark", async () => {
    const pool = pgliteAsPool(pglite);
    const older = "2026-04-01T10:00:00.000Z";
    const newer = "2026-04-20T10:00:00.000Z";
    await seedVs90TrackAndListen(pglite, { userId: USER_ADV, playedAtIso: newer });
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark, last_succeeded_at
       ) values ($1::uuid, 'fresh', $2::text, $3::timestamptz, now())`,
      [USER_ADV, LAYER1_ACTIVE_SIGNAL_VERSION, older],
    );
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "listen_ingested",
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_ADV,
      reason: "listen_ingested",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("returns skipped_retry_exhausted for routine reasons when user hit VS-84 failure cap", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(`delete from layer1_user_recompute_state where user_id = $1::uuid`, [USER_ADV]);
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message, consecutive_failure_count
       ) values ($1::uuid, 'failed_exhausted', $2::text, null,
         null, null, null, now(), 'layer1_test_exhausted', 'stopped', 8)`,
      [USER_ADV, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "listen_ingested",
    });
    expect(out).toEqual({
      outcome: "skipped_retry_exhausted",
      userId: USER_ADV,
      reason: "listen_ingested",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("resets failed_exhausted and enqueues for admin_manual", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan) values ($1::uuid, 'layer1-enq-adv-b@example.test', 'x', 'advanced')`,
      [USER_ADV_B],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message, consecutive_failure_count
       ) values ($1::uuid, 'failed_exhausted', $2::text, null,
         null, null, null, now(), 'layer1_test_exhausted', 'stopped', 8)`,
      [USER_ADV_B, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    const { queue, addMock } = createMockQueue();
    const out = await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV_B,
      reason: "admin_manual",
    });
    expect(out).toEqual({
      outcome: "enqueued",
      userId: USER_ADV_B,
      reason: "admin_manual",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const row = await getLayer1UserRecomputeStateRow(pool, USER_ADV_B);
    expect(row?.status).toBe("queued");
    expect(row?.consecutiveFailureCount).toBe(0);
  });

  it("propagates BullMQ publish errors", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    addMock.mockRejectedValueOnce(new Error("redis publish failed"));
    await expect(
      enqueueLayer1EvidenceRecomputeForUser({
        db: pool,
        queue,
        userId: USER_ADV,
        reason: "signal_version_changed",
      }),
    ).rejects.toThrow("redis publish failed");
  });

  it("stores import_completed in the BullMQ job payload", async () => {
    const pool = pgliteAsPool(pglite);
    const { queue, addMock } = createMockQueue();
    await enqueueLayer1EvidenceRecomputeForUser({
      db: pool,
      queue,
      userId: USER_ADV,
      reason: "import_completed",
    });
    const [, payload] = addMock.mock.calls[0] as [string, { enqueueReason: string }];
    expect(payload.enqueueReason).toBe("import_completed");
  });

  it("lists exactly the VS-78 Layer 1 enqueue reason codes", () => {
    expect(LAYER1_EVIDENCE_RECOMPUTE_ENQUEUE_REASON_CODES).toEqual([
      "import_completed",
      "listen_ingested",
      "advanced_upgrade",
      "signal_version_changed",
      "nightly_reconciliation",
      "admin_manual",
      "internal_backfill",
    ]);
  });
});
