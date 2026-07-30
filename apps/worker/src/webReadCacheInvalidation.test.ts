import { describe, expect, it, vi, afterEach } from "vitest";
import type { ServerEnv } from "@vs/env";
import {
  notifyWebAppListeningHistoryReadCacheInvalidationBestEffort,
  resolveWebReadCacheInvalidationOrigin,
} from "./webReadCacheInvalidation.js";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("webReadCacheInvalidation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolveWebReadCacheInvalidationOrigin prefers VS_WEB_INTERNAL_ORIGIN over publicAppOrigin", () => {
    const env = {
      VS_WEB_INTERNAL_ORIGIN: "http://internal.web:3000/",
      publicAppOrigin: "https://public.example",
    } as unknown as ServerEnv;
    expect(resolveWebReadCacheInvalidationOrigin(env)).toBe("http://internal.web:3000");
  });

  it("resolveWebReadCacheInvalidationOrigin falls back to publicAppOrigin", () => {
    const env = {
      publicAppOrigin: "https://app.example.com",
    } as unknown as ServerEnv;
    expect(resolveWebReadCacheInvalidationOrigin(env)).toBe("https://app.example.com");
  });

  it("notifyWebAppListeningHistoryReadCacheInvalidationBestEffort no-ops without origin", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const env = {
      VS_INTERNAL_API_SECRET: "x".repeat(32),
    } as unknown as ServerEnv;
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, USER);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("notifyWebAppListeningHistoryReadCacheInvalidationBestEffort no-ops without internal secret", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const env = {
      VS_WEB_INTERNAL_ORIGIN: "http://localhost:3000",
    } as unknown as ServerEnv;
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, USER);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to the web internal route when origin and secret are set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const secret = "y".repeat(32);
    const env = {
      VS_WEB_INTERNAL_ORIGIN: "http://localhost:3000",
      VS_INTERNAL_API_SECRET: secret,
    } as unknown as ServerEnv;
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, USER);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/internal/cache/invalidate-user-read-cache");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    });
    expect(JSON.parse(init.body as string)).toEqual({ user_id: USER });
  });

  it("emits structured queue_activity warn when HTTP response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      VS_WEB_INTERNAL_ORIGIN: "http://localhost:3000",
      VS_INTERNAL_API_SECRET: "z".repeat(32),
    } as unknown as ServerEnv;
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, USER);
    expect(warnSpy).toHaveBeenCalledOnce();
    const line = String(warnSpy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.event).toBe("web_read_cache_invalidation_failed");
    expect(parsed.queue).toBe("web_read_cache_invalidation");
    expect(parsed.userId).toBe(USER);
    expect(parsed.detail).toEqual({ http_status: 503, reason: "http_non_2xx" });
  });

  it("emits structured queue_activity warn when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      VS_WEB_INTERNAL_ORIGIN: "http://localhost:3000",
      VS_INTERNAL_API_SECRET: "z".repeat(32),
    } as unknown as ServerEnv;
    await notifyWebAppListeningHistoryReadCacheInvalidationBestEffort(env, USER);
    expect(warnSpy).toHaveBeenCalledOnce();
    const line = String(warnSpy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.event).toBe("web_read_cache_invalidation_failed");
    expect(parsed.failure).toMatchObject({
      errorType: "Error",
      errorMessage: "ECONNREFUSED",
    });
    expect(parsed.detail).toEqual({ reason: "fetch_error" });
  });
});
