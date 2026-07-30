import type { Pool } from "pg";

type Db = Pick<Pool, "query">;

/**
 * Staff-facing aggregate counts for `/admin` overview.
 * Lifecycle SQL for invites must stay aligned with {@link resolveBetaInviteLifecycleState}
 * in `@vs/domain` (ordering: revoked → expired → exhausted → active).
 */
export type AdminOverviewMetrics = Readonly<{
  /** ISO-8601 timestamp for when aggregates were computed (server clock). */
  computedAtIso: string;
  /** Seconds threshold used for `staleRunningImports` (matches worker / probe tooling). */
  staleRunningImportProbeSeconds: number;
  users: Readonly<{
    total: number;
    active: number;
    verifiedEmail: number;
    /** Counts from `users.product_plan` (schema allows only `core` and `advanced`). */
    productPlan: Readonly<{
      core: number;
      advanced: number;
    }>;
  }>;
  invites: Readonly<{
    total: number;
    active: number;
    exhausted: number;
    expired: number;
    revoked: number;
    /** Rows in `beta_invite_redemptions` (successful signups via an invite). */
    redemptionRows: number;
  }>;
  importJobs: Readonly<{
    /** All sources: counts keyed by persisted `import_jobs.stage`. */
    byStage: Record<string, number>;
    /** Subset where `source = 'user'` (guided / dashboard imports). */
    userSourceByStage: Record<string, number>;
    /** `running` rows with `updated_at` older than the stale probe window. */
    staleRunningImports: number;
  }>;
  onboarding: Readonly<{
    /** Counts keyed by persisted `users.onboarding_state`. */
    byState: Record<string, number>;
  }>;
}>;

function intCell(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function rowCountMap(
  rows: ReadonlyArray<{ k: string; c: unknown }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.k] = intCell(r.c);
  }
  return out;
}

/**
 * Loads aggregate admin overview metrics in a small number of read-only queries.
 */
export async function getAdminOverviewMetrics(
  db: Db,
  input: Readonly<{
    nowMs: number;
    staleRunningImportAfterSeconds: number;
  }>,
): Promise<AdminOverviewMetrics> {
  const nowIso = new Date(input.nowMs).toISOString();
  const rawStale = Math.floor(Number(input.staleRunningImportAfterSeconds));
  const staleSec =
    Number.isFinite(rawStale) && rawStale >= 1 ? rawStale : 600;

  const [
    userAgg,
    inviteAgg,
    redemptionAgg,
    importStageAgg,
    importUserStageAgg,
    staleRunningAgg,
    onboardingAgg,
  ] = await Promise.all([
    db.query<{
      total: unknown;
      active: unknown;
      verified_email: unknown;
      product_plan_core: unknown;
      product_plan_advanced: unknown;
    }>(
      `select count(*)::int as total,
              count(*) filter (where account_status = 'active')::int as active,
              count(*) filter (where email_verified_at is not null)::int as verified_email,
              count(*) filter (where product_plan = 'core')::int as product_plan_core,
              count(*) filter (where product_plan = 'advanced')::int as product_plan_advanced
       from users`,
    ),
    db.query<{
      total: unknown;
      revoked: unknown;
      expired: unknown;
      exhausted: unknown;
      active: unknown;
    }>(
      `select count(*)::int as total,
              count(*) filter (where revoked_at is not null)::int as revoked,
              count(*) filter (where revoked_at is null
                and expires_at is not null
                and expires_at <= $1::timestamptz)::int as expired,
              count(*) filter (where revoked_at is null
                and (expires_at is null or expires_at > $1::timestamptz)
                and used_count >= max_uses)::int as exhausted,
              count(*) filter (where revoked_at is null
                and (expires_at is null or expires_at > $1::timestamptz)
                and used_count < max_uses)::int as active
       from beta_invites`,
      [nowIso],
    ),
    db.query<{ c: unknown }>(`select count(*)::int as c from beta_invite_redemptions`),
    db.query<{ stage: string; c: unknown }>(
      `select stage, count(*)::int as c from import_jobs group by stage`,
    ),
    db.query<{ stage: string; c: unknown }>(
      `select stage, count(*)::int as c
       from import_jobs
       where source = 'user'
       group by stage`,
    ),
    db.query<{ c: unknown }>(
      `select count(*)::int as c
       from import_jobs
       where stage = 'running'
         and updated_at < $1::timestamptz - ($2::bigint * interval '1 second')`,
      [nowIso, String(staleSec)],
    ),
    db.query<{ onboarding_state: string; c: unknown }>(
      `select onboarding_state, count(*)::int as c from users group by onboarding_state`,
    ),
  ]);

  const ur = userAgg.rows[0];
  const ir = inviteAgg.rows[0];
  const rr = redemptionAgg.rows[0];

  return {
    computedAtIso: nowIso,
    staleRunningImportProbeSeconds: staleSec,
    users: {
      total: intCell(ur?.total),
      active: intCell(ur?.active),
      verifiedEmail: intCell(ur?.verified_email),
      productPlan: {
        core: intCell(ur?.product_plan_core),
        advanced: intCell(ur?.product_plan_advanced),
      },
    },
    invites: {
      total: intCell(ir?.total),
      active: intCell(ir?.active),
      exhausted: intCell(ir?.exhausted),
      expired: intCell(ir?.expired),
      revoked: intCell(ir?.revoked),
      redemptionRows: intCell(rr?.c),
    },
    importJobs: {
      byStage: rowCountMap(
        importStageAgg.rows.map((r) => ({ k: r.stage, c: r.c })),
      ),
      userSourceByStage: rowCountMap(
        importUserStageAgg.rows.map((r) => ({ k: r.stage, c: r.c })),
      ),
      staleRunningImports: intCell(staleRunningAgg.rows[0]?.c),
    },
    onboarding: {
      byState: rowCountMap(
        onboardingAgg.rows.map((r) => ({
          k: r.onboarding_state,
          c: r.c,
        })),
      ),
    },
  };
}
