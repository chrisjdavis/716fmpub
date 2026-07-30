import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetFixedWindowRateLimitStoreForTests } from "@/server/api/fixed-window-rate-limit";
import { middleware } from "./middleware";

afterEach(() => {
  delete process.env.VS_API_RATE_LIMIT_AUTH_MAX;
  delete process.env.VS_API_RATE_LIMIT_AUTH_WINDOW_MS;
  delete process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX;
  delete process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS;
  delete process.env.VS_API_RATE_LIMIT_SENSITIVE_POST_MAX;
  delete process.env.VS_API_RATE_LIMIT_SENSITIVE_POST_WINDOW_MS;
  resetFixedWindowRateLimitStoreForTests();
});

describe("middleware rate limiting", () => {
  beforeEach(() => {
    process.env.VS_API_RATE_LIMIT_AUTH_MAX = "2";
    process.env.VS_API_RATE_LIMIT_AUTH_WINDOW_MS = "60000";
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX = "1000";
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS = "60000";
  });

  it("returns 429 with Retry-After when the auth bucket is exhausted for an IP", () => {
    const url = "http://localhost/api/auth/login";
    const headers = { "x-forwarded-for": "203.0.113.44" };

    const first = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(first.status).not.toBe(429);

    const second = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(second.status).not.toBe(429);

    const third = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("returns 429 with Retry-After when the auth bucket is exhausted for verify-email", () => {
    const url = "http://localhost/api/auth/verify-email";
    const headers = { "x-forwarded-for": "203.0.113.61" };

    expect(
      middleware(new NextRequest(new URL(url), { method: "POST", headers })).status,
    ).not.toBe(429);
    expect(
      middleware(new NextRequest(new URL(url), { method: "POST", headers })).status,
    ).not.toBe(429);
    const third = middleware(new NextRequest(new URL(url), { method: "POST", headers }));
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("does not rate-limit OPTIONS", () => {
    process.env.VS_API_RATE_LIMIT_AUTH_MAX = "1";
    const url = "http://localhost/api/auth/login";
    const headers = { "x-forwarded-for": "203.0.113.99" };
    const a = middleware(new NextRequest(new URL(url), { method: "OPTIONS", headers }));
    const b = middleware(new NextRequest(new URL(url), { method: "OPTIONS", headers }));
    expect(a.status).not.toBe(429);
    expect(b.status).not.toBe(429);
  });

  it("returns 429 with Retry-After when the email_outbound bucket is exhausted for recovery request", () => {
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX = "2";
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS = "60000";
    const url = "http://localhost/api/auth/recovery/request";
    const headers = { "x-forwarded-for": "198.51.100.12" };

    const first = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(first.status).not.toBe(429);

    const second = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(second.status).not.toBe(429);

    const third = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("returns 429 when the email_outbound bucket is exhausted for resend-verification", () => {
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX = "2";
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS = "60000";
    const url = "http://localhost/api/me/resend-verification";
    const headers = { "x-forwarded-for": "198.51.100.77" };

    const first = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(first.status).not.toBe(429);

    const second = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(second.status).not.toBe(429);

    const third = middleware(
      new NextRequest(new URL(url), { method: "POST", headers }),
    );
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("returns 429 when the email_outbound bucket is exhausted for signup", () => {
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX = "2";
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS = "60000";
    const url = "http://localhost/api/auth/setup";
    const headers = { "x-forwarded-for": "198.51.100.55" };

    const first = middleware(new NextRequest(new URL(url), { method: "POST", headers }));
    expect(first.status).not.toBe(429);

    const second = middleware(new NextRequest(new URL(url), { method: "POST", headers }));
    expect(second.status).not.toBe(429);

    const third = middleware(new NextRequest(new URL(url), { method: "POST", headers }));
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("shares the email_outbound counter across signup and recovery for the same IP", () => {
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX = "2";
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS = "60000";
    const headers = { "x-forwarded-for": "198.51.100.88" };
    expect(
      middleware(
        new NextRequest(new URL("http://localhost/api/auth/setup"), {
          method: "POST",
          headers,
        }),
      ).status,
    ).not.toBe(429);
    expect(
      middleware(
        new NextRequest(new URL("http://localhost/api/auth/recovery/request"), {
          method: "POST",
          headers,
        }),
      ).status,
    ).not.toBe(429);
    expect(
      middleware(
        new NextRequest(new URL("http://localhost/api/me/resend-verification"), {
          method: "POST",
          headers,
        }),
      ).status,
    ).toBe(429);
  });

  it("emits structured console.warn for email_outbound cap and hard rate limit", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_MAX = "2";
    process.env.VS_API_RATE_LIMIT_EMAIL_OUTBOUND_WINDOW_MS = "60000";
    const url = "http://localhost/api/auth/setup";
    const headers = { "x-forwarded-for": "198.51.100.201" };

    middleware(new NextRequest(new URL(url), { method: "POST", headers }));
    middleware(new NextRequest(new URL(url), { method: "POST", headers }));
    middleware(new NextRequest(new URL(url), { method: "POST", headers }));

    const payloads = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(payloads.some((p) => p.event === "vs_api_abuse_email_outbound_window_cap_reached")).toBe(
      true,
    );
    expect(payloads.some((p) => p.event === "vs_api_abuse_email_outbound_rate_limited")).toBe(true);
    warn.mockRestore();
  });
});
