import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CSRF_COOKIE_NAME, AUTH_SESSION_COOKIE_NAME, API_CSRF_HEADER_NAME } from "@vs/domain";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const query = vi.fn();
const connect = vi.fn();
const release = vi.fn();
const clientQuery = vi.fn();
const countUsers = vi.fn();

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: () => ({ query, connect }),
    insertSoleOwnerUser: vi.fn(),
    countUsers: (...args: unknown[]) => countUsers(...args),
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    NODE_ENV: "test",
    deployEnv: "test",
    trustProxyHeaders: false,
    ...defaultAbuseEnvFields,
  })),
  isStrictDeployEnv: vi.fn(() => false),
  isRedisQueuesEnabled: vi.fn(() => false),
}));

vi.mock("@/server/api/auth-abuse-rate-limit", () => ({
  rejectIfAuthAbuseRateLimited: vi.fn(async () => null),
}));

const CSRF = "test-csrf-token-value-32chars!!";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) =>
      name === AUTH_CSRF_COOKIE_NAME ? { value: CSRF } : undefined,
  }),
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed"),
}));

import { insertSoleOwnerUser } from "@vs/db";
import { hashPassword } from "@/server/auth/password";
import { GET, POST } from "./route";

function getSetCookieLines(res: Response): string[] {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const sc = res.headers.get("set-cookie");
  return sc ? [sc] : [];
}

function setupRequest(init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.method !== "GET") {
    headers.set("content-type", "application/json");
  }
  if (!headers.has(API_CSRF_HEADER_NAME) && init?.method !== "GET") {
    headers.set(API_CSRF_HEADER_NAME, CSRF);
  }
  return new Request("http://localhost/api/auth/setup", {
    ...init,
    headers,
  });
}

describe("GET /api/auth/setup", () => {
  it("bootstraps a CSRF cookie", async () => {
    const res = await GET(setupRequest({ method: "GET" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; bootstrapSecretRequired: boolean };
    expect(body.ok).toBe(true);
    expect(body.bootstrapSecretRequired).toBe(false);
    const cookies = getSetCookieLines(res).join("\n");
    expect(cookies).toContain(AUTH_CSRF_COOKIE_NAME);
  });
});

describe("POST /api/auth/setup", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const email = "owner@test.dev";

  beforeEach(() => {
    vi.clearAllMocks();
    countUsers.mockResolvedValue(0);
    connect.mockResolvedValue({ query: clientQuery, release });
    clientQuery.mockImplementation(async (sql: string) => {
      if (typeof sql === "string" && sql.includes("insert into sessions")) {
        return { rows: [{ id: "sess" }] };
      }
      return { rows: [] };
    });
    vi.mocked(insertSoleOwnerUser).mockResolvedValue({ ok: true, userId });
  });

  it("creates the first owner account and sets session cookies", async () => {
    const req = setupRequest({
      method: "POST",
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toEqual({ id: userId, email });
    const cookies = getSetCookieLines(res).join("\n");
    expect(cookies).toContain(AUTH_SESSION_COOKIE_NAME);
    expect(cookies).toContain(AUTH_CSRF_COOKIE_NAME);
    expect(insertSoleOwnerUser).toHaveBeenCalled();
    expect(hashPassword).toHaveBeenCalled();
  });

  it("returns 403 when CSRF proof is missing", async () => {
    const req = new Request("http://localhost/api/auth/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "csrf_invalid" });
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("returns 409 before hashing when the instance is already configured", async () => {
    countUsers.mockResolvedValue(1);
    const req = setupRequest({
      method: "POST",
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Already set up",
      code: "already_configured",
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(insertSoleOwnerUser).not.toHaveBeenCalled();
  });

  it("returns 409 when insertSoleOwnerUser reports already configured", async () => {
    vi.mocked(insertSoleOwnerUser).mockResolvedValue({
      ok: false,
      reason: "already_configured",
    });
    const req = setupRequest({
      method: "POST",
      body: JSON.stringify({ email, password: "correct-horse-battery-staple" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "Already set up",
      code: "already_configured",
    });
  });

  it("returns 403 when bootstrap secret is configured but missing/wrong", async () => {
    const { loadServerEnv } = await import("@vs/env");
    vi.mocked(loadServerEnv).mockReturnValueOnce({
      NODE_ENV: "test",
      deployEnv: "test",
      trustProxyHeaders: false,
      VS_SETUP_BOOTSTRAP_SECRET: "correct-bootstrap-secret!!",
      ...defaultAbuseEnvFields,
    } as ReturnType<typeof loadServerEnv>);
    const req = setupRequest({
      method: "POST",
      body: JSON.stringify({
        email,
        password: "correct-horse-battery-staple",
        bootstrapSecret: "wrong-secret",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "bootstrap_secret_invalid" });
    expect(insertSoleOwnerUser).not.toHaveBeenCalled();
  });
});
