import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getReadCacheMetricsSnapshot,
  invalidateUserScopedReadCaches,
  resetUserScopedReadCacheForTests,
  userScopedTtlGetOrSet,
} from "./user-scoped-ttl-read-cache";

describe("userScopedTtlGetOrSet", () => {
  describe("TTL behaviour (fake timers)", () => {
    beforeEach(() => {
      resetUserScopedReadCacheForTests();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns miss then store_hit for the same scoped key", async () => {
      const factory = vi.fn().mockResolvedValue(42);
      const a = await userScopedTtlGetOrSet({
        namespace: "t_ns",
        ttlMs: 60_000,
        userId: "u1",
        keyParts: ["a"],
        factory,
      });
      expect(a.telemetry.served_from).toBe("miss");
      const b = await userScopedTtlGetOrSet({
        namespace: "t_ns",
        ttlMs: 60_000,
        userId: "u1",
        keyParts: ["a"],
        factory,
      });
      expect(b.telemetry.served_from).toBe("store_hit");
      expect(b.value).toBe(42);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(getReadCacheMetricsSnapshot().t_ns).toEqual({
        storeHits: 1,
        inflightWaits: 0,
        misses: 1,
      });
    });

    it("does not share cache across users", async () => {
      const factory = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
      const a = await userScopedTtlGetOrSet({
        namespace: "t_ns",
        ttlMs: 60_000,
        userId: "u1",
        keyParts: ["x"],
        factory,
      });
      const b = await userScopedTtlGetOrSet({
        namespace: "t_ns",
        ttlMs: 60_000,
        userId: "u2",
        keyParts: ["x"],
        factory,
      });
      expect(a.value).toBe(1);
      expect(b.value).toBe(2);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it("expires after TTL", async () => {
      const factory = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
      const first = await userScopedTtlGetOrSet({
        namespace: "t_ns",
        ttlMs: 1000,
        userId: "u1",
        keyParts: ["k"],
        factory,
      });
      expect(first.telemetry.served_from).toBe("miss");
      vi.advanceTimersByTime(1001);
      const second = await userScopedTtlGetOrSet({
        namespace: "t_ns",
        ttlMs: 1000,
        userId: "u1",
        keyParts: ["k"],
        factory,
      });
      expect(second.telemetry.served_from).toBe("miss");
      expect(second.value).toBe(2);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it("invalidateUserScopedReadCaches drops entries for that user", async () => {
      const factory = vi.fn().mockResolvedValue(7);
      await userScopedTtlGetOrSet({
        namespace: "n1",
        ttlMs: 60_000,
        userId: "user-a",
        keyParts: ["p"],
        factory,
      });
      await userScopedTtlGetOrSet({
        namespace: "n2",
        ttlMs: 60_000,
        userId: "user-b",
        keyParts: ["p"],
        factory,
      });
      expect(factory).toHaveBeenCalledTimes(2);
      invalidateUserScopedReadCaches("user-a");
      factory.mockResolvedValue(9);
      const again = await userScopedTtlGetOrSet({
        namespace: "n1",
        ttlMs: 60_000,
        userId: "user-a",
        keyParts: ["p"],
        factory,
      });
      expect(again.value).toBe(9);
      const bHit = await userScopedTtlGetOrSet({
        namespace: "n2",
        ttlMs: 60_000,
        userId: "user-b",
        keyParts: ["p"],
        factory,
      });
      expect(bHit.telemetry.served_from).toBe("store_hit");
      expect(factory).toHaveBeenCalledTimes(3);
    });
  });

  describe("in-flight coalescing (real timers)", () => {
    beforeEach(() => {
      resetUserScopedReadCacheForTests();
    });

    it("parallel misses coalesce: exactly one miss and one inflight_wait", async () => {
      const factory = vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 25));
        return 7;
      });
      const p1 = userScopedTtlGetOrSet({
        namespace: "co_ns",
        ttlMs: 60_000,
        userId: "u1",
        keyParts: ["x"],
        factory,
      });
      const p2 = userScopedTtlGetOrSet({
        namespace: "co_ns",
        ttlMs: 60_000,
        userId: "u1",
        keyParts: ["x"],
        factory,
      });
      const [a, b] = await Promise.all([p1, p2]);
      expect(factory).toHaveBeenCalledTimes(1);
      const kinds = new Set([a.telemetry.served_from, b.telemetry.served_from]);
      expect(kinds.has("miss")).toBe(true);
      expect(kinds.has("inflight_wait")).toBe(true);
      expect(getReadCacheMetricsSnapshot().co_ns).toEqual({
        storeHits: 0,
        inflightWaits: 1,
        misses: 1,
      });
    });
  });
});
