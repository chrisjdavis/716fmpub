import { DatabaseError } from "pg";

/** Postgres `unique_violation` — safe to use from API routes without importing `pg` directly. */
export function isPostgresUniqueViolation(err: unknown): boolean {
  return err instanceof DatabaseError && err.code === "23505";
}
