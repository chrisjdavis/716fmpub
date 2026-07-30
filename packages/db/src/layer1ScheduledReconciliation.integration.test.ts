import { LAYER1_ACTIVE_SIGNAL_VERSION } from "@vs/domain";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import { listAdvancedUserIdsNeedingLayer1Reconciliation } from "./layer1ScheduledReconciliation.js";

const U_ADV_NONE = "11111111-1111-4111-8111-111111111111";
const U_CORE = "22222222-2222-4222-8222-222222222222";
const U_ADV_QUEUED = "33333333-3333-4333-8333-333333333333";
const U_ADV_STALE_SIG = "44444444-4444-4444-8444-444444444444";
const U_ADV_WM = "55555555-5555-4555-8555-555555555555";
const U_ADV_FAIL_RECENT = "66666666-6666-4666-8666-666666666666";
const U_ADV_FAIL_OLD = "77777777-7777-4777-8777-777777777777";
const U_ADV_EXHAUSTED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const JOB_WM = "88888888-8888-4888-8888-888888888888";

describe.sequential("listAdvancedUserIdsNeedingLayer1Reconciliation (PGlite)", () => {
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
      `insert into users (id, email, password_hash, product_plan) values
         ($1::uuid, 'l1r-none@example.test', 'x', 'advanced'),
         ($2::uuid, 'l1r-core@example.test', 'x', 'core'),
         ($3::uuid, 'l1r-queued@example.test', 'x', 'advanced'),
         ($4::uuid, 'l1r-stalesig@example.test', 'x', 'advanced'),
         ($5::uuid, 'l1r-wm@example.test', 'x', 'advanced'),
         ($6::uuid, 'l1r-fail-recent@example.test', 'x', 'advanced'),
         ($7::uuid, 'l1r-fail-old@example.test', 'x', 'advanced'),
         ($8::uuid, 'l1r-exhausted@example.test', 'x', 'advanced')`,
      [
        U_ADV_NONE,
        U_CORE,
        U_ADV_QUEUED,
        U_ADV_STALE_SIG,
        U_ADV_WM,
        U_ADV_FAIL_RECENT,
        U_ADV_FAIL_OLD,
        U_ADV_EXHAUSTED,
      ],
    );

    const wm = new Date("2025-01-01T00:00:00.000Z");
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message
       ) values
       ($1::uuid, 'queued', $2::text, now(), now(), now(), now(), null, null, null)`,
      [U_ADV_QUEUED, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message
       ) values
       ($1::uuid, 'fresh', 'legacy-signal-v0', now(), now(), now(), now(), null, null, null)`,
      [U_ADV_STALE_SIG],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message
       ) values
       ($1::uuid, 'fresh', $2::text, $3::timestamptz, now(), now(), now(), null, null, null)`,
      [U_ADV_WM, LAYER1_ACTIVE_SIGNAL_VERSION, wm],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message
       ) values
       ($1::uuid, 'failed', $2::text, null, null, null, null,
         now() - interval '1 minute', 'unit_test_fail', 'x')`,
      [U_ADV_FAIL_RECENT, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message
       ) values
       ($1::uuid, 'failed', $2::text, null, null, null, null,
         now() - interval '3 hours', 'unit_test_fail', 'x')`,
      [U_ADV_FAIL_OLD, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, input_watermark,
         last_enqueued_at, last_started_at, last_succeeded_at,
         last_failed_at, failure_code, failure_message, consecutive_failure_count
       ) values ($1::uuid, 'failed_exhausted', $2::text, null,
         null, null, null, now() - interval '1 day', 'unit_test_exhausted', 'x', 50)`,
      [U_ADV_EXHAUSTED, LAYER1_ACTIVE_SIGNAL_VERSION],
    );

    await pglite.query(
      `insert into import_jobs (id, user_id, label, stage, lastfm_username, updated_at)
       values ($1::uuid, $2::uuid, 'wm-bump', 'completed', 'u', $3::timestamptz)`,
      [JOB_WM, U_ADV_WM, new Date("2026-06-01T12:00:00.000Z")],
    );
  });

  it("returns Advanced users with missing, stale-signal, watermark-lag, or cooldown-eligible failed state; excludes Core and queued", async () => {
    const pool = pgliteAsPool(pglite);
    const ids = await listAdvancedUserIdsNeedingLayer1Reconciliation(pool, {
      activeSignalVersion: LAYER1_ACTIVE_SIGNAL_VERSION,
      failedRetryCooldownSec: 3_600,
      limit: 50,
    });
    const set = new Set(ids);
    expect(set.has(U_ADV_NONE)).toBe(true);
    expect(set.has(U_ADV_STALE_SIG)).toBe(true);
    expect(set.has(U_ADV_WM)).toBe(true);
    expect(set.has(U_ADV_FAIL_OLD)).toBe(true);
    expect(set.has(U_CORE)).toBe(false);
    expect(set.has(U_ADV_QUEUED)).toBe(false);
    expect(set.has(U_ADV_FAIL_RECENT)).toBe(false);
    expect(set.has(U_ADV_EXHAUSTED)).toBe(false);
  });

  it("treats recent failures as eligible when cooldown is zero", async () => {
    const pool = pgliteAsPool(pglite);
    const ids = await listAdvancedUserIdsNeedingLayer1Reconciliation(pool, {
      activeSignalVersion: LAYER1_ACTIVE_SIGNAL_VERSION,
      failedRetryCooldownSec: 0,
      limit: 50,
    });
    expect(new Set(ids).has(U_ADV_FAIL_RECENT)).toBe(true);
  });
});
