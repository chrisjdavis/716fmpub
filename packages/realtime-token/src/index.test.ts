import { describe, expect, it } from "vitest";
import { signListenRealtimeToken, verifyListenRealtimeToken } from "./index.js";

describe("listen realtime token", () => {
  const secret = "x".repeat(32);

  it("round-trips a valid token", () => {
    const t = signListenRealtimeToken(secret, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 60);
    const out = verifyListenRealtimeToken(secret, t);
    expect(out?.userId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("rejects tampered payload", () => {
    const t = signListenRealtimeToken(secret, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 60);
    const tampered = `bogus${t.slice(4)}`;
    expect(verifyListenRealtimeToken(secret, tampered)).toBeNull();
  });

  it("rejects wrong secret", () => {
    const t = signListenRealtimeToken(secret, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 60);
    expect(verifyListenRealtimeToken("y".repeat(32), t)).toBeNull();
  });
});
