import { describe, expect, it } from "vitest";
import { resolveBetaInviteLifecycleState } from "./betaInviteLifecycle.js";

describe("resolveBetaInviteLifecycleState", () => {
  const nowMs = 1_700_000_000_000;

  it("returns revoked when revoked_at is set", () => {
    expect(
      resolveBetaInviteLifecycleState({
        revokedAt: new Date(nowMs - 60_000),
        expiresAt: new Date(nowMs + 60_000),
        usedCount: 0,
        maxUses: 5,
        nowMs,
      }),
    ).toBe("revoked");
  });

  it("returns expired before exhausted when both time and cap would apply", () => {
    expect(
      resolveBetaInviteLifecycleState({
        revokedAt: null,
        expiresAt: new Date(nowMs - 1),
        usedCount: 10,
        maxUses: 3,
        nowMs,
      }),
    ).toBe("expired");
  });

  it("returns exhausted when not expired and uses reached cap", () => {
    expect(
      resolveBetaInviteLifecycleState({
        revokedAt: null,
        expiresAt: new Date(nowMs + 60_000),
        usedCount: 3,
        maxUses: 3,
        nowMs,
      }),
    ).toBe("exhausted");
  });

  it("returns active when within window and under cap", () => {
    expect(
      resolveBetaInviteLifecycleState({
        revokedAt: null,
        expiresAt: new Date(nowMs + 60_000),
        usedCount: 0,
        maxUses: 1,
        nowMs,
      }),
    ).toBe("active");
  });

  it("treats null expires_at as non-expiring", () => {
    expect(
      resolveBetaInviteLifecycleState({
        revokedAt: null,
        expiresAt: null,
        usedCount: 0,
        maxUses: 2,
        nowMs,
      }),
    ).toBe("active");
  });
});
