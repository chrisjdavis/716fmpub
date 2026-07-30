import { afterEach, describe, expect, it } from "vitest";
import {
  consumeFixedWindowToken,
  resetFixedWindowRateLimitStoreForTests,
} from "./fixed-window-rate-limit";

afterEach(() => {
  resetFixedWindowRateLimitStoreForTests();
});

describe("consumeFixedWindowToken", () => {
  it("allows up to max requests within the window", () => {
    const t0 = 1_000_000;
    const a = consumeFixedWindowToken({ key: "k", max: 2, windowMs: 60_000, nowMs: t0 });
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.countInWindow).toBe(1);
    }
    const b = consumeFixedWindowToken({ key: "k", max: 2, windowMs: 60_000, nowMs: t0 + 1 });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.countInWindow).toBe(2);
    }
    const denied = consumeFixedWindowToken({
      key: "k",
      max: 2,
      windowMs: 60_000,
      nowMs: t0 + 2,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("resets after the window elapses", () => {
    const t0 = 5_000_000;
    const first = consumeFixedWindowToken({ key: "k2", max: 1, windowMs: 1000, nowMs: t0 });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.countInWindow).toBe(1);
    }
    expect(
      consumeFixedWindowToken({ key: "k2", max: 1, windowMs: 1000, nowMs: t0 + 500 }).ok,
    ).toBe(false);
    expect(
      consumeFixedWindowToken({ key: "k2", max: 1, windowMs: 1000, nowMs: t0 + 1000 }).ok,
    ).toBe(true);
  });
});
