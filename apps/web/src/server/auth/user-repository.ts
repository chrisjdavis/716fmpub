import type { Pool } from "pg";

import { accountEmailIdentityKey, canonicalizeAccountEmail } from "./canonical-email";

type Db = Pick<Pool, "query">;

export async function insertUser(
  db: Db,
  email: string,
  passwordHash: string,
): Promise<{ id: string }> {
  const canonicalEmail = canonicalizeAccountEmail(email);
  const { rows } = await db.query<{ id: string }>(
    `insert into users (email, password_hash)
     values ($1, $2)
     returning id`,
    [canonicalEmail, passwordHash],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("user insert returned no row");
  }
  return row;
}

export async function findUserWithPasswordByEmail(
  db: Db,
  email: string,
): Promise<{
  id: string;
  email: string;
  password_hash: string;
  account_role: string;
} | null> {
  const canonicalEmail = canonicalizeAccountEmail(email);
  const identityKey = accountEmailIdentityKey(email);
  const { rows } = await db.query<{
    id: string;
    email: string;
    password_hash: string;
    account_role: string;
  }>(
    `select id, email, password_hash, account_role
       from users
      where account_status = 'active'
        and (
             email = $1
          or (
              lower(split_part(trim(lower(email)), '@', 2)) in ('gmail.com', 'googlemail.com')
          and replace(
                regexp_replace(lower(split_part(trim(lower(email)), '@', 1)), '\\+.*$', ''),
                '.',
                ''
              ) || '@gmail.com' = $2
            )
            )
      limit 1`,
    [canonicalEmail, identityKey],
  );
  return rows[0] ?? null;
}

export async function findUserPasswordHashById(
  db: Db,
  userId: string,
): Promise<{ password_hash: string } | null> {
  const { rows } = await db.query<{ password_hash: string }>(
    `select password_hash from users where id = $1::uuid limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function findUserEmailById(db: Db, userId: string): Promise<{ email: string } | null> {
  const { rows } = await db.query<{ email: string }>(
    `select email from users where id = $1::uuid limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function updateUserPasswordHash(
  db: Db,
  userId: string,
  passwordHash: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    `update users set password_hash = $2, updated_at = now() where id = $1::uuid`,
    [userId, passwordHash],
  );
  return (rowCount ?? 0) > 0;
}
