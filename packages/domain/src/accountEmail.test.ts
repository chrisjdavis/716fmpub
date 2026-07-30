import { describe, expect, it } from "vitest";
import { accountEmailIdentityKey, canonicalizeAccountEmail } from "./accountEmail.js";

describe("canonicalizeAccountEmail", () => {
  it("trims surrounding whitespace and lowercases ASCII", () => {
    expect(canonicalizeAccountEmail("  User@Test.DEV  ")).toBe("user@test.dev");
  });

  it("is idempotent on already-canonical values", () => {
    const once = canonicalizeAccountEmail("a@b.co");
    expect(canonicalizeAccountEmail(once)).toBe("a@b.co");
  });

  it("NFC-normalizes before casing so decomposed sequences match composed ones", () => {
    const decomposed = `e\u0301@x.example`;
    const composed = `\u00e9@x.example`;
    expect(canonicalizeAccountEmail(decomposed)).toBe(canonicalizeAccountEmail(composed));
  });
});

describe("accountEmailIdentityKey", () => {
  it("leaves non-Gmail addresses as the canonical form", () => {
    expect(accountEmailIdentityKey("  A@Sub.Example  ")).toBe("a@sub.example");
  });

  it("strips dots and +tags from Gmail locals and maps to gmail.com", () => {
    expect(accountEmailIdentityKey("First.Last+newsletter@gmail.com")).toBe("firstlast@gmail.com");
  });

  it("treats googlemail.com like gmail.com for identity", () => {
    expect(accountEmailIdentityKey("u.ser@GoogleMail.com")).toBe("user@gmail.com");
  });
});
