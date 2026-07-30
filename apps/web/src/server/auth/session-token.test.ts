import { describe, expect, it } from "vitest";
import { hashSessionToken, newSessionToken } from "./session-token";

describe("session-token", () => {
  it("produces URL-safe opaque tokens", () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes deterministically per token", () => {
    const t = "unit-test-token";
    expect(hashSessionToken(t)).toBe(hashSessionToken(t));
    expect(hashSessionToken(t)).not.toBe(hashSessionToken(`${t}x`));
  });
});
