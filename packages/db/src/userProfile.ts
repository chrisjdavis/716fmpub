import type { Pool } from "pg";
import {
  decryptSecret,
  encryptSecret,
  parseSecretsEncryptionKey,
} from "@vs/sensitive";

type Db = Pick<Pool, "query">;

export type UserProfileFields = Readonly<{
  display_name: string | null;
  lastfm_username: string | null;
  /** True when `users.lastfm_api_key` is non-null (secret is never selected here). */
  has_lastfm_api_key: boolean;
  /** IANA timezone for stats day boundaries; null = infer from edge headers or UTC. */
  stats_timezone: string | null;
}>;

/**
 * Reads `VS_SECRETS_ENCRYPTION_KEY` from process env (validated at boot via `@vs/env`).
 * Returns null when unset so local/unit tests keep plaintext storage.
 */
function secretsEncryptionKeyOrNull(): Buffer | null {
  const raw = process.env.VS_SECRETS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return null;
  }
  return parseSecretsEncryptionKey(raw);
}

function encodeLastfmApiKeyForStorage(plaintext: string | null): string | null {
  if (plaintext === null) {
    return null;
  }
  const key = secretsEncryptionKeyOrNull();
  if (!key) {
    return plaintext;
  }
  return encryptSecret(plaintext, key);
}

function decodeLastfmApiKeyFromStorage(stored: string): string {
  const key = secretsEncryptionKeyOrNull();
  if (!key) {
    return stored;
  }
  return decryptSecret(stored, key);
}

export async function getUserProfileFields(
  db: Db,
  userId: string,
): Promise<UserProfileFields | null> {
  const { rows } = await db.query<UserProfileFields>(
    `select display_name, lastfm_username,
            (lastfm_api_key is not null) as has_lastfm_api_key,
            stats_timezone
     from users
     where id = $1::uuid
     limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * Returns the stored Last.fm API key for background imports, or `null` when unset.
 * Decrypts `enc:v1:` blobs when `VS_SECRETS_ENCRYPTION_KEY` is configured; legacy
 * plaintext rows are returned as-is. Call only from trusted server/worker code.
 */
export async function getUserLastfmApiKey(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ lastfm_api_key: string | null }>(
    `select lastfm_api_key
     from users
     where id = $1::uuid
     limit 1`,
    [userId],
  );
  const raw = rows[0]?.lastfm_api_key;
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const decoded = decodeLastfmApiKeyFromStorage(trimmed).trim();
  return decoded === "" ? null : decoded;
}

export type UserProfileUpdateInput = Readonly<{
  displayName?: string | null;
  lastfmUsername?: string | null;
  lastfmApiKey?: string | null;
  statsTimezone?: string | null;
}>;

/**
 * Updates only keys present on `fields`. Use `null` to clear a column.
 * `updated_at` is always touched when at least one column updates.
 * When `VS_SECRETS_ENCRYPTION_KEY` is set, `lastfmApiKey` is stored encrypted.
 */
export async function updateUserProfileFields(
  db: Db,
  userId: string,
  fields: UserProfileUpdateInput,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if ("displayName" in fields) {
    sets.push(`display_name = $${i++}`);
    values.push(fields.displayName);
  }
  if ("lastfmUsername" in fields) {
    sets.push(`lastfm_username = $${i++}`);
    values.push(fields.lastfmUsername);
  }
  if ("lastfmApiKey" in fields) {
    sets.push(`lastfm_api_key = $${i++}`);
    values.push(
      fields.lastfmApiKey === undefined
        ? undefined
        : encodeLastfmApiKeyForStorage(fields.lastfmApiKey),
    );
  }
  if ("statsTimezone" in fields) {
    sets.push(`stats_timezone = $${i++}`);
    values.push(fields.statsTimezone);
  }
  if (sets.length === 0) {
    return;
  }
  sets.push("updated_at = now()");
  values.push(userId);
  await db.query(
    `update users set ${sets.join(", ")} where id = $${i}::uuid`,
    values,
  );
}
