import { PGlite } from "@electric-sql/pglite";
import { LAYER1_ACTIVE_SIGNAL_VERSION } from "@vs/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getAdminUserDetailById } from "./adminUserDetail.js";
import { insertBetaInvite } from "./betaInvites.js";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";

const CREATOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const ARTIST_ID = "33333333-3333-4333-8333-333333333333";
const ALBUM_ID = "44444444-4444-4444-8444-444444444444";
const TRACK_ID = "55555555-5555-4555-8555-555555555555";

describe.sequential("getAdminUserDetailById (PGlite)", () => {
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
      `insert into users (id, email, password_hash, created_at)
       values ($1::uuid, 'creator@test', 'h', '2000-01-01T00:00:00.000Z')`,
      [CREATOR_ID],
    );
  });

  it("returns null when the user id does not exist", async () => {
    const pool = pgliteAsPool(pglite);
    const r = await getAdminUserDetailById(pool, TARGET_ID);
    expect(r).toBeNull();
  });

  it("returns account, onboarding defaults, and zeroed import/listen counts", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, display_name, account_role, account_status,
                          created_at, email_verified_at, stats_timezone)
       values ($1::uuid, 'u@test', 'h', 'U One', 'user', 'active',
               '2026-02-01T00:00:00.000Z', '2026-02-01T01:00:00.000Z', 'America/Chicago')`,
      [TARGET_ID],
    );
    const r = await getAdminUserDetailById(pool, TARGET_ID);
    expect(r).not.toBeNull();
    expect(r!.user.email).toBe("u@test");
    expect(r!.user.display_name).toBe("U One");
    expect(r!.user.product_plan).toBe("core");
    expect(r!.account.emailVerifiedAt).toBe("2026-02-01T01:00:00.000Z");
    expect(r!.account.statsTimezone).toBe("America/Chicago");
    expect(r!.onboarding.state).toBe("not_started");
    expect(r!.signupBetaInvite).toBeNull();
    expect(r!.importSummary.totalJobCount).toBe(0);
    expect(r!.importSummary.listenCount).toBe(0);
    expect(r!.importSummary.latestUserJob).toBeNull();
    expect(r!.importSummary.latestUserImportStatus).toBe("none");
    expect(r!.layer1.listeningProductTier).toBe("core");
    expect(r!.layer1.manualRecompute.eligible).toBe(false);
    expect(r!.layer1.persistedRecomputeStatus).toBe("absent");
    expect(r!.layer1.effectiveStatus).toBe("never_computed");
    expect(r!.layer1.lastMaterializedSignalVersion).toBeNull();
    expect(r!.layer1.lastMaterializedSignalVersionProvenance).toBe("none");
    expect(r!.layer1.activeSignalVersion).toBe(LAYER1_ACTIVE_SIGNAL_VERSION);
  });

  it("includes invite provenance, redemption time, listens, and latest user import job", async () => {
    const pool = pgliteAsPool(pglite);
    const { invite } = await insertBetaInvite(pool, {
      createdByUserId: CREATOR_ID,
      maxUses: 3,
      lockedEmail: "lock@test",
    });
    await pglite.query(
      `insert into users (id, email, password_hash, signup_beta_invite_id, onboarding_state,
                          created_at, updated_at)
       values ($1::uuid, 'inv@test', 'h', $2::uuid, 'import_in_progress',
               '2026-03-01T00:00:00.000Z', '2026-03-02T00:00:00.000Z')`,
      [TARGET_ID, invite.id],
    );
    await pglite.query(
      `insert into beta_invite_redemptions (invite_id, redeemed_user_id, redeemed_at)
       values ($1::uuid, $2::uuid, '2026-03-01T00:30:00.000Z')`,
      [invite.id, TARGET_ID],
    );
    const JOB_ID = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    await pglite.query(
      `insert into import_jobs (id, user_id, label, lastfm_username, stage, source, items_processed)
       values ($1::uuid, $2::uuid, 'archive', 'lfm', 'running', 'user', 12)`,
      [JOB_ID, TARGET_ID],
    );
    await pglite.query(
      `insert into artists (id, name, name_key)
       values ($1::uuid, 'Detail Artist', lower(regexp_replace(trim('Detail Artist'), '[[:space:]]+', ' ', 'g')))`,
      [ARTIST_ID],
    );
    await pglite.query(
      `insert into albums (id, artist_id, title, title_key)
       values ($1::uuid, $2::uuid, 'Detail Album', lower(regexp_replace(trim('Detail Album'), '[[:space:]]+', ' ', 'g')))`,
      [ALBUM_ID, ARTIST_ID],
    );
    await pglite.query(
      `insert into tracks (id, artist_id, album_id, title, title_key)
       values ($1::uuid, $2::uuid, $3::uuid, 'Detail Track', lower(regexp_replace(trim('Detail Track'), '[[:space:]]+', ' ', 'g')))`,
      [TRACK_ID, ARTIST_ID, ALBUM_ID],
    );
    await pglite.query(
      `insert into listens (user_id, track_id, played_at, import_job_id)
       values ($1::uuid, $2::uuid, '2026-03-01T12:00:00.000Z', $3::uuid)`,
      [TARGET_ID, TRACK_ID, JOB_ID],
    );

    const r = await getAdminUserDetailById(pool, TARGET_ID);
    expect(r!.signupBetaInvite).toMatchObject({
      id: invite.id,
      lockedEmail: "lock@test",
      maxUses: 3,
      redeemedAt: "2026-03-01T00:30:00.000Z",
    });
    expect(r!.importSummary.totalJobCount).toBe(1);
    expect(r!.importSummary.activeJobCount).toBe(1);
    expect(r!.importSummary.listenCount).toBe(1);
    expect(r!.importSummary.latestUserJob?.id).toBe(JOB_ID);
    expect(r!.importSummary.latestUserImportStatus).toBe("running");
    expect(r!.onboarding.state).toBe("import_in_progress");
    expect(r!.layer1.listeningProductTier).toBe("core");
  });

  it("surfaces persisted Layer 1 recompute state for Advanced accounts", async () => {
    const pool = pgliteAsPool(pglite);
    await pglite.query(
      `insert into users (id, email, password_hash, product_plan, created_at)
       values ($1::uuid, 'adv@test', 'h', 'advanced', '2026-04-01T00:00:00.000Z')`,
      [TARGET_ID],
    );
    await pglite.query(
      `insert into layer1_user_recompute_state (
         user_id, status, signal_version, last_enqueued_at, last_started_at, last_succeeded_at, input_watermark
       ) values (
         $1::uuid, 'fresh', $2::text,
         '2026-04-01T01:00:00.000Z', '2026-04-01T01:01:00.000Z', '2026-04-01T01:02:00.000Z',
         '2026-04-01T00:30:00.000Z'
       )`,
      [TARGET_ID, LAYER1_ACTIVE_SIGNAL_VERSION],
    );
    const r = await getAdminUserDetailById(pool, TARGET_ID);
    expect(r!.layer1.listeningProductTier).toBe("advanced");
    expect(r!.layer1.manualRecompute.eligible).toBe(true);
    expect(r!.layer1.persistedRecomputeStatus).toBe("fresh");
    expect(r!.layer1.persistedSignalVersion).toBe(LAYER1_ACTIVE_SIGNAL_VERSION);
    expect(r!.layer1.lastEnqueuedAt).toBe("2026-04-01T01:00:00.000Z");
    expect(r!.layer1.lastStartedAt).toBe("2026-04-01T01:01:00.000Z");
    expect(r!.layer1.lastSucceededAt).toBe("2026-04-01T01:02:00.000Z");
  });
});
