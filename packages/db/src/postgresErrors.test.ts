import { DatabaseError } from "pg";
import { describe, expect, it } from "vitest";

import { isPostgresUniqueViolation } from "./postgresErrors.js";

describe("isPostgresUniqueViolation", () => {
  it("returns true for unique_violation (23505)", () => {
    const err = new DatabaseError("dup", 10, "error");
    err.code = "23505";
    expect(isPostgresUniqueViolation(err)).toBe(true);
  });

  it("returns false for other errors", () => {
    expect(isPostgresUniqueViolation(new Error("x"))).toBe(false);
    const other = new DatabaseError("x", 10, "error");
    other.code = "23503";
    expect(isPostgresUniqueViolation(other)).toBe(false);
  });
});
