import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import { cache } from "react";
import type { AuthenticatedUser } from "./session";
import { readSessionRawToken, validateSession } from "./session";

/** Resolves the HttpOnly session cookie to a user; see docs/security-architecture.md. */
export const getServerSession = cache(async function getServerSession(): Promise<AuthenticatedUser | null> {
  const raw = await readSessionRawToken();
  if (!raw) {
    return null;
  }
  const env = loadServerEnv();
  const pool = getPool(env);
  const v = await validateSession(pool, raw, "rsc");
  return v?.user ?? null;
});
