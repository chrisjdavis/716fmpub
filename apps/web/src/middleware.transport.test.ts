import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEdgeTransportContext } from "@/server/http/edge-transport-context";
import { resetFixedWindowRateLimitStoreForTests } from "@/server/api/fixed-window-rate-limit";
import { middleware } from "./middleware";
import { transportInsecureResponse } from "./middleware.transport";

afterEach(() => {
  delete process.env.VS_DEPLOY_ENV;
  delete process.env.VS_TRUST_PROXY_HEADERS;
  delete process.env.VS_PUBLIC_APP_ORIGIN;
  resetFixedWindowRateLimitStoreForTests();
});

describe("transportInsecureResponse", () => {
  it("returns a 308 redirect to the configured public origin for GET when strict and not https", () => {
    const ctx = readEdgeTransportContext({
      NODE_ENV: "development",
      VS_DEPLOY_ENV: "staging",
      VS_TRUST_PROXY_HEADERS: "false",
      VS_PUBLIC_APP_ORIGIN: "https://listen.example.com",
    });
    expect(ctx.strict).toBe(true);
    const req = new NextRequest(
      new URL("http://127.0.0.1:3456/dashboard"),
      { method: "GET" },
    );
    const res = transportInsecureResponse(req, ctx);
    expect(res?.status).toBe(308);
    expect(res?.headers.get("location")).toBe("https://listen.example.com/dashboard");
  });

  it("returns 403 JSON for mutating methods when strict and not https", async () => {
    const ctx = readEdgeTransportContext({
      NODE_ENV: "development",
      VS_DEPLOY_ENV: "staging",
      VS_TRUST_PROXY_HEADERS: "true",
      VS_PUBLIC_APP_ORIGIN: "https://listen.example.com",
    });
    const req = new NextRequest(new URL("http://127.0.0.1:3456/api/auth/login"), {
      method: "POST",
      headers: { "x-forwarded-proto": "http" },
    });
    const res = transportInsecureResponse(req, ctx);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: "insecure_transport" });
  });
});

describe("browser security headers on middleware responses", () => {
  it("sets CSP and related headers on a non-API HTML route", () => {
    process.env.VS_DEPLOY_ENV = "development";
    process.env.VS_TRUST_PROXY_HEADERS = "false";
    delete process.env.VS_PUBLIC_APP_ORIGIN;
    const res = middleware(
      new NextRequest(new URL("http://127.0.0.1:3456/login"), { method: "GET" }),
    );
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  });

  it("sets hardened CSP on API routes in production mode", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    process.env.VS_DEPLOY_ENV = "staging";
    process.env.VS_TRUST_PROXY_HEADERS = "false";
    process.env.VS_PUBLIC_APP_ORIGIN = "https://listen.example.com";
    process.env.VS_API_RATE_LIMIT_AUTH_MAX = "100";
    process.env.NEXT_PUBLIC_LISTEN_REALTIME_WS_URL = "wss://rt.example.com/listen";
    const url = "https://listen.example.com/api/auth/login";
    const res = middleware(
      new NextRequest(new URL(url), {
        method: "POST",
        headers: { host: "listen.example.com" },
      }),
    );
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic' 'unsafe-inline'/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("https://static.cloudflareinsights.com");
    expect(csp).toContain("wss://rt.example.com");
    process.env.NODE_ENV = prev;
    delete process.env.NEXT_PUBLIC_LISTEN_REALTIME_WS_URL;
  });
});

describe("middleware rate limit with proxy trust", () => {
  beforeEach(() => {
    process.env.VS_API_RATE_LIMIT_AUTH_MAX = "2";
    process.env.VS_API_RATE_LIMIT_AUTH_WINDOW_MS = "60000";
  });

  it("uses distinct client IPs from x-forwarded-for only when VS_TRUST_PROXY_HEADERS=true", () => {
    process.env.VS_DEPLOY_ENV = "staging";
    process.env.VS_TRUST_PROXY_HEADERS = "true";
    process.env.VS_PUBLIC_APP_ORIGIN = "https://listen.example.com";
    const url = "https://listen.example.com/api/auth/login";
    const a = middleware(
      new NextRequest(new URL(url), {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.10", host: "listen.example.com" },
      }),
    );
    const b = middleware(
      new NextRequest(new URL(url), {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.11", host: "listen.example.com" },
      }),
    );
    expect(a.status).not.toBe(429);
    expect(b.status).not.toBe(429);
  });
});
