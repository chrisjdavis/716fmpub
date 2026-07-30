import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

/** Fixed legacy `scrypt$v1$` vector for password `legacy-verify-test` (salt = 0x07…). */
const LEGACY_SCRYPT_FIXTURE =
  "scrypt$v1$07070707070707070707070707070707$c7874bd682fd09c2d75f68e333d0bb91dc472a883f0419b8ee439307c57e0d961ea3bda5342b97989fabfbda1bbbf610e1d7e3b6f1c801e2c95ed8ce2001ebe2";

describe("password", () => {
  it("round-trips an Argon2id password hash", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(
      true,
    );
  });

  it("rejects a wrong password against Argon2id", async () => {
    const stored = await hashPassword("secret-value-one");
    expect(await verifyPassword("secret-value-two", stored)).toBe(false);
  });

  it("verifies legacy scrypt$v1$ hashes", async () => {
    expect(await verifyPassword("legacy-verify-test", LEGACY_SCRYPT_FIXTURE)).toBe(
      true,
    );
    expect(await verifyPassword("wrong-legacy-password", LEGACY_SCRYPT_FIXTURE)).toBe(
      false,
    );
  });

  it("rejects malformed stored strings", async () => {
    expect(await verifyPassword("x", "not-scrypt$v1$")).toBe(false);
    expect(await verifyPassword("x", "scrypt$v1$bad")).toBe(false);
    expect(await verifyPassword("x", "$argon2id$invalid")).toBe(false);
  });
});
