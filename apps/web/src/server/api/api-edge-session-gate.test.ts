import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { AUTH_SESSION_COOKIE_NAME } from "@vs/domain/auth-session-cookie";
import { API_UNAUTHENTICATED_BODY } from "@/server/api/api-auth-response";
import { sessionCookieGateResponse } from "@/server/api/api-edge-session-gate";

function req(url: string, init?: { cookie?: string; method?: string }): NextRequest {
  const headers = new Headers();
  if (init?.cookie !== undefined) {
    headers.set("cookie", `${AUTH_SESSION_COOKIE_NAME}=${init.cookie}`);
  }
  return new NextRequest(new URL(url, "http://localhost"), {
    method: init?.method ?? "GET",
    headers,
  });
}

describe("sessionCookieGateResponse", () => {
  it("allows OPTIONS without a cookie", () => {
    expect(
      sessionCookieGateResponse(req("http://localhost/api/me", { method: "OPTIONS" })),
    ).toBeNull();
  });

  it("allows public auth routes without a cookie", () => {
    expect(sessionCookieGateResponse(req("http://localhost/api/auth/login"))).toBeNull();
    expect(sessionCookieGateResponse(req("http://localhost/api/auth/setup"))).toBeNull();
    expect(sessionCookieGateResponse(req("http://localhost/api/auth/logout"))).toBeNull();
    expect(
      sessionCookieGateResponse(req("http://localhost/api/auth/recovery/request")),
    ).toBeNull();
    expect(
      sessionCookieGateResponse(req("http://localhost/api/auth/recovery/confirm")),
    ).toBeNull();
    expect(
      sessionCookieGateResponse(req("http://localhost/api/auth/verify-email")),
    ).toBeNull();
    expect(
      sessionCookieGateResponse(req("http://localhost/api/auth/verify-email-change")),
    ).toBeNull();
  });

  it("allows public listening analytics routes without a cookie", () => {
    expect(
      sessionCookieGateResponse(req("http://localhost/api/public/analytics/archive-listens")),
    ).toBeNull();
    expect(
      sessionCookieGateResponse(req("http://localhost/api/public/analytics/window-total")),
    ).toBeNull();
    expect(
      sessionCookieGateResponse(req("http://localhost/api/public/analytics/summary")),
    ).toBeNull();
  });

  it("allows internal API routes without a session cookie", () => {
    expect(
      sessionCookieGateResponse(
        req("http://localhost/api/internal/analytics/dashboard-default-snapshot"),
      ),
    ).toBeNull();
  });

  it("returns 401 JSON when a protected route has no session cookie", async () => {
    const res = sessionCookieGateResponse(req("http://localhost/api/me"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    expect(await res!.json()).toEqual(API_UNAUTHENTICATED_BODY);
  });

  it("allows protected routes when a non-empty session cookie is present", () => {
    expect(
      sessionCookieGateResponse(
        req("http://localhost/api/me", { cookie: "opaque-token-value" }),
      ),
    ).toBeNull();
  });

  it("rejects blank cookie values", async () => {
    const res = sessionCookieGateResponse(req("http://localhost/api/me", { cookie: "   " }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});
