import type { Pool, QueryResultRow } from "pg";
import { pgTimestamptzToIsoString } from "./pgTimestamptz.js";

type Db = Pick<Pool, "query">;

/** Canonical 8-4-4-4-12 hex UUID form (Postgres `uuid` text rendering). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CURSOR_V1 = 1 as const;
const CURSOR_V2 = 2 as const;

/** Request fingerprint for admin user list (search + optional plan filter). */
export type AdminUserListRequestFingerprint = Readonly<{
  q: string | null;
  productPlan: "core" | "advanced" | null;
}>;

/** Decoded cursor position and embedded fingerprint (v2) or legacy v1 marker. */
export type AdminUserListDecodedCursor = Readonly<{
  createdAt: string;
  id: string;
  /** True when decoded from legacy `v:1` payload (no embedded filters). */
  legacyV1: boolean;
  productPlan: "core" | "advanced" | null;
  q: string | null;
}>;

export type AdminUserListRecord = Readonly<{
  id: string;
  email: string;
  display_name: string | null;
  lastfm_username: string | null;
  account_role: string;
  account_status: string;
  /** `users.product_plan` text (application validates known tiers). */
  product_plan: string;
  created_at: string;
  signup_beta_invite_id: string | null;
  invite_locked_email: string | null;
  invite_created_at: string | null;
  invite_created_by_user_id: string | null;
}>;

export type ListUsersForAdminArgs = Readonly<{
  /** Case-insensitive substring match on email, display_name, and lastfm_username. */
  q?: string | null;
  /** When set, only users with this `users.product_plan` are returned. */
  productPlan?: "core" | "advanced" | null;
  /** Page size before the +1 probe row; clamped to [1, 200], default 50. */
  limit?: number | null;
  cursor?: string | null;
}>;

export type ListUsersForAdminResult = Readonly<{
  users: AdminUserListRecord[];
  nextCursor: string | null;
}>;

function normalizeSearch(q?: string | null): string | null {
  const raw = q?.trim() ?? "";
  return raw === "" ? null : raw.slice(0, 200);
}

function normalizeProductPlanFilter(
  p?: "core" | "advanced" | null,
): "core" | "advanced" | null {
  return p ?? null;
}

/**
 * Normalized fingerprint for {@link listUsersForAdmin} query params.
 * Use with {@link adminUserListDecodedCursorMatchesFingerprint} when validating cursors.
 */
export function adminUserListRequestFingerprintFromArgs(
  args: Pick<ListUsersForAdminArgs, "q" | "productPlan">,
): AdminUserListRequestFingerprint {
  return {
    q: normalizeSearch(args.q),
    productPlan: normalizeProductPlanFilter(args.productPlan ?? null),
  };
}

export function adminUserListDecodedCursorMatchesFingerprint(
  decoded: AdminUserListDecodedCursor,
  fp: AdminUserListRequestFingerprint,
): boolean {
  if (decoded.legacyV1) {
    // v1 payloads never embedded search or plan; reject if the request implies otherwise.
    return fp.productPlan === null && fp.q === null;
  }
  return decoded.productPlan === fp.productPlan && decoded.q === fp.q;
}

function mapAdminUserListRow(row: QueryResultRow): AdminUserListRecord {
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    display_name:
      row["display_name"] === null || row["display_name"] === undefined
        ? null
        : String(row["display_name"]),
    lastfm_username:
      row["lastfm_username"] === null || row["lastfm_username"] === undefined
        ? null
        : String(row["lastfm_username"]),
    account_role: String(row["account_role"]),
    account_status: String(row["account_status"]),
    product_plan: String(row["product_plan"]),
    created_at: pgTimestamptzToIsoString(row["created_at"]),
    signup_beta_invite_id:
      row["signup_beta_invite_id"] === null ||
      row["signup_beta_invite_id"] === undefined
        ? null
        : String(row["signup_beta_invite_id"]),
    invite_locked_email:
      row["invite_locked_email"] === null ||
      row["invite_locked_email"] === undefined
        ? null
        : String(row["invite_locked_email"]),
    invite_created_at:
      row["invite_created_at"] === null || row["invite_created_at"] === undefined
        ? null
        : pgTimestamptzToIsoString(row["invite_created_at"]),
    invite_created_by_user_id:
      row["invite_created_by_user_id"] === null ||
      row["invite_created_by_user_id"] === undefined
        ? null
        : String(row["invite_created_by_user_id"]),
  };
}

const ADMIN_USER_LIST_SELECT = `select u.id,
            u.email,
            u.display_name,
            u.lastfm_username,
            u.account_role,
            u.account_status,
            u.product_plan,
            u.created_at,
            u.signup_beta_invite_id,
            bi.locked_email as invite_locked_email,
            bi.created_at as invite_created_at,
            bi.created_by_user_id as invite_created_by_user_id
     from users u
     left join beta_invites bi on bi.id = u.signup_beta_invite_id`;

/**
 * Encodes a keyset cursor for {@link listUsersForAdmin} (opaque to clients).
 * Embeds the list fingerprint (v2) so cursors cannot be reused under a different filter.
 */
export function encodeAdminUserListCursor(
  position: Readonly<{ createdAt: string; id: string }>,
  fingerprint: AdminUserListRequestFingerprint,
): string {
  return Buffer.from(
    JSON.stringify({
      v: CURSOR_V2,
      createdAt: position.createdAt,
      id: position.id,
      productPlan: fingerprint.productPlan,
      q: fingerprint.q,
    }),
    "utf8",
  ).toString("base64url");
}

function parseQField(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  return normalizeSearch(raw);
}

/**
 * Returns a validated cursor payload, or `null` when `raw` is missing/empty/invalid.
 */
export function tryDecodeAdminUserListCursor(
  raw: string | null | undefined,
): AdminUserListDecodedCursor | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(trimmed, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) {
    return null;
  }
  const o = json as Record<string, unknown>;
  const v = o["v"];
  const createdAt = o["createdAt"];
  const id = o["id"];
  if (typeof createdAt !== "string" || createdAt.length < 10) {
    return null;
  }
  if (!Number.isFinite(Date.parse(createdAt))) {
    return null;
  }
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return null;
  }

  if (v === CURSOR_V1) {
    return {
      createdAt,
      id,
      legacyV1: true,
      productPlan: null,
      q: null,
    };
  }

  if (v === CURSOR_V2) {
    const rawPlan = o["productPlan"];
    let productPlan: "core" | "advanced" | null;
    if (rawPlan === undefined || rawPlan === null) {
      productPlan = null;
    } else if (rawPlan === "core" || rawPlan === "advanced") {
      productPlan = rawPlan;
    } else {
      return null;
    }
    const q = parseQField(o["q"]);
    if (o["q"] != null && o["q"] !== undefined && typeof o["q"] !== "string") {
      return null;
    }
    return {
      createdAt,
      id,
      legacyV1: false,
      productPlan,
      q,
    };
  }

  return null;
}

/**
 * Staff-only listing over `users` with optional text filter, optional product plan filter,
 * and stable keyset pagination (`created_at desc`, `id desc`). Never selects password material.
 */
export async function listUsersForAdmin(
  db: Db,
  args: ListUsersForAdminArgs,
): Promise<ListUsersForAdminResult> {
  const pageLimit =
    args.limit === null || args.limit === undefined
      ? 50
      : Math.min(200, Math.max(1, args.limit));
  const fetchLimit = pageLimit + 1;

  const fingerprint = adminUserListRequestFingerprintFromArgs(args);
  const search = fingerprint.q;
  const planFilter = fingerprint.productPlan;

  const cursorPayload = tryDecodeAdminUserListCursor(args.cursor ?? null);
  const cursorTs = cursorPayload?.createdAt ?? null;
  const cursorId = cursorPayload?.id ?? null;

  const { rows } = await db.query<QueryResultRow>(
    `${ADMIN_USER_LIST_SELECT}
     where ($1::text is null
            or position(lower($1) in lower(u.email)) > 0
            or position(lower($1) in lower(coalesce(u.display_name, ''))) > 0
            or position(lower($1) in lower(coalesce(u.lastfm_username, ''))) > 0)
       and ($2::text is null or u.product_plan = $2::text)
       and ($3::timestamptz is null
            or (u.created_at, u.id) < ($3::timestamptz, $4::uuid))
     order by u.created_at desc, u.id desc
     limit $5::int`,
    [search, planFilter, cursorTs, cursorId, fetchLimit],
  );

  const mapped = rows.map((r) => mapAdminUserListRow(r));
  const hasMore = mapped.length > pageLimit;
  const page = hasMore ? mapped.slice(0, pageLimit) : mapped;
  const tail = page[page.length - 1];
  const nextCursor =
    hasMore && tail
      ? encodeAdminUserListCursor(
          { createdAt: tail.created_at, id: tail.id },
          fingerprint,
        )
      : null;

  return { users: page, nextCursor };
}

/**
 * Loads one user row for admin surfaces (same projection as {@link listUsersForAdmin}).
 */
export async function getAdminUserListRecordById(
  db: Db,
  userId: string,
): Promise<AdminUserListRecord | null> {
  const { rows } = await db.query<QueryResultRow>(
    `${ADMIN_USER_LIST_SELECT}
     where u.id = $1::uuid
     limit 1`,
    [userId],
  );
  const row = rows[0];
  return row ? mapAdminUserListRow(row) : null;
}
