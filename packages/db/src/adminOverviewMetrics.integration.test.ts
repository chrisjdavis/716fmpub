import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAdminOverviewMetrics } from "./adminOverviewMetrics.js";
import { insertBetaInvite } from "./betaInvites.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const CREATOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const JOB_STALE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_FRESH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB_STALE_SYNC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe.sequential("getAdminOverviewMetrics (PGlite)", () => {
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

  it("returns zeroed aggregates on an empty database", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.UTC(2026, 5, 1, 12, 0, 0);
    const m = await getAdminOverviewMetrics(pool, {
      nowMs,
      staleRunningImportAfterSeconds: 120,
    });
    expect(m.users).toEqual({
      total: 0,
      active: 0,
      verifiedEmail: 0,
      productPlan: { core: 0, advanced: 0 },
    });
    expect(m.invites).toEqual({
      total: 0,
      active: 0,
      exhausted: 0,
      expired: 0,
      revoked: 0,
      redemptionRows: 0,
    });
    expect(m.importJobs.staleRunningImports).toBe(0);
    expect(m.importJobs.byStage).toEqual({});
    expect(m.importJobs.userSourceByStage).toEqual({});
    expect(m.onboarding.byState).toEqual({});
    expect(m.staleRunningImportProbeSeconds).toBe(120);
  });

  it("aggregates users, invites, redemptions, imports, stale running, and onboarding", async () => {
    const pool = pgliteAsPool(pglite);
    const nowMs = Date.UTC(2026, 6, 15, 12, 0, 0);
    const nowIso = new Date(nowMs).toISOString();

    await pglite.query(
      `insert into users (id, email, password_hash, account_status, email_verified_at,
                          onboarding_state, product_plan, created_at)
       values ($1::uuid, 'creator@test', 'h', 'active', $2::timestamptz, 'not_started', 'core', $2::timestamptz),
              ($3::uuid, 'alice@test', 'h', 'active', $2::timestamptz, 'completed', 'advanced', $2::timestamptz),
              ($4::uuid, 'bob@test', 'h', 'suspended', null, 'import_in_progress', 'core', $2::timestamptz),
              ($5::uuid, 'carol@test', 'h', 'active', $2::timestamptz, 'not_started', 'core', $2::timestamptz)`,
      [CREATOR_ID, nowIso, U1, U2, U3],
    );

    const { invite: activeInv } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 5,
    });
    const { invite: exhaustedInv } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 1,
    });
    await pglite.query(
      `update beta_invites set used_count = 1, updated_at = $1::timestamptz where id = $2::uuid`,
      [nowIso, exhaustedInv.id],
    );
    await pglite.query(
      `insert into beta_invites (id, token_hash, locked_email, max_uses, used_count, expires_at,
                                 revoked_at, revoked_reason, created_by_user_id, created_at, updated_at)
       values ($1::uuid, repeat('f', 64), null, 5, 0, $2::timestamptz, null, null, $3::uuid, $4::timestamptz, $4::timestamptz)`,
      ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", "2026-01-01T00:00:00.000Z", CREATOR_ID, nowIso],
    );
    const { invite: revokedInv } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 2,
    });
    await pglite.query(
      `update beta_invites set revoked_at = $1::timestamptz, revoked_reason = 'test' where id = $2::uuid`,
      [nowIso, revokedInv.id],
    );

    await pglite.query(
      `insert into beta_invite_redemptions (invite_id, redeemed_user_id, redeemed_at)
       values ($1::uuid, $2::uuid, $3::timestamptz)`,
      [activeInv.id, U1, nowIso],
    );

    await pglite.query(
      `insert into import_jobs (id, user_id, label, lastfm_username, stage, source, items_processed, updated_at)
       values ($1::uuid, $2::uuid, 'a', 'lf1', 'completed', 'user', 0, $3::timestamptz),
              ($4::uuid, $5::uuid, 'b', 'lf2', 'running', 'system_sync', 0, $6::timestamptz),
              ($7::uuid, $8::uuid, 'c', 'lf3', 'running', 'system_sync', 0, $3::timestamptz)`,
      [JOB_STALE, U1, nowIso, JOB_FRESH, U2, "2026-01-01T00:00:00.000Z", JOB_STALE_SYNC, U3],
    );

    const m = await getAdminOverviewMetrics(pool, {
      nowMs,
      staleRunningImportAfterSeconds: 86_400,
    });

    expect(m.users).toEqual({
      total: 4,
      active: 3,
      verifiedEmail: 3,
      productPlan: { core: 3, advanced: 1 },
    });
    expect(m.invites.total).toBe(4);
    expect(m.invites.active).toBe(1);
    expect(m.invites.exhausted).toBe(1);
    expect(m.invites.expired).toBe(1);
    expect(m.invites.revoked).toBe(1);
    expect(m.invites.redemptionRows).toBe(1);

    expect(m.importJobs.byStage.completed).toBe(1);
    expect(m.importJobs.byStage.running).toBe(2);
    expect(m.importJobs.userSourceByStage.completed).toBe(1);
    expect(m.importJobs.staleRunningImports).toBe(1);

    expect(m.onboarding.byState.not_started).toBe(2);
    expect(m.onboarding.byState.completed).toBe(1);
    expect(m.onboarding.byState.import_in_progress).toBe(1);
  });
});
