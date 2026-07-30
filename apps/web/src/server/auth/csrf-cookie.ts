import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_CSRF_HEADER_NAME, AUTH_CSRF_COOKIE_NAME } from "@vs/domain";
import { loadServerEnv } from "@vs/env";
import { isSessionCookieSecure, sessionCookieMaxAgeSec } from "@/server/auth/session";

export function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function applyCsrfCookie(res: NextResponse, rawToken: string): void {
  const env = loadServerEnv();
  res.cookies.set({
    name: AUTH_CSRF_COOKIE_NAME,
    value: rawToken,
    httpOnly: false,
    sameSite: "lax",
    secure: isSessionCookieSecure(env),
    path: "/",
    maxAge: sessionCookieMaxAgeSec(),
  });
}

export function clearCsrfCookie(res: NextResponse): void {
  const env = loadServerEnv();
  res.cookies.set({
    name: AUTH_CSRF_COOKIE_NAME,
    value: "",
    httpOnly: false,
    sameSite: "lax",
    secure: isSessionCookieSecure(env),
    path: "/",
    maxAge: 0,
  });
}

export async function readCsrfCookieRaw(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(AUTH_CSRF_COOKIE_NAME)?.value;
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function csrfDoubleSubmitValidSync(
  headerRaw: string | undefined,
  cookieRaw: string | undefined,
): boolean {
  const h = headerRaw?.trim();
  const c = cookieRaw?.trim();
  if (!h || !c) {
    return false;
  }
  return timingSafeEqualUtf8(h, c);
}

/**
 * Double-submit check: non-HttpOnly CSRF cookie must match the request header.
 * Uses `cookies()` for the cookie side and `Request` headers for the header side.
 */
export async function csrfDoubleSubmitValid(request: Request): Promise<boolean> {
  const headerRaw = request.headers.get(API_CSRF_HEADER_NAME) ?? undefined;
  const cookieRaw = await readCsrfCookieRaw();
  return csrfDoubleSubmitValidSync(headerRaw, cookieRaw);
}

export function isUnsafeHttpMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}
