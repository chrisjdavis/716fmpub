import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CSRF_COOKIE_NAME, AUTH_SESSION_COOKIE_NAME } from "@vs/domain";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";
import { hashSessionToken } from "@/server/auth/session-token";

const query = vi.fn();

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: () => ({ query }),
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    NODE_ENV: "test",
    deployEnv: "test",
    ...defaultAbuseEnvFields,
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/server/auth/user-repository", () => ({
  findUserWithPasswordByEmail: vi.fn(),
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

import { cookies } from "next/headers";
import { findUserWithPasswordByEmail } from "@/server/auth/user-repository";
import { verifyPassword } from "@/server/auth/password";
import { POST } from "./route";

function getSetCookieLines(res: Response): string[] {
  if (typeof res.headers.getSetCookie === "function") {
    return res.headers.getSetCookie();
  }
  const sc = res.headers.get("set-cookie");
  return sc ? [sc] : [];
}

describe("POST /api/auth/login", () => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const email = "u@test.dev";

  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation((sql: string) => {
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValue({
      id: userId,
      email,
      password_hash: "stored-hash",
      account_role: "user",
    });
    vi.mocked(verifyPassword).mockResolvedValue(true);
  });

  it("invalidates prior cookie session and all user sessions before creating a new session", async () => {
    const priorRaw = "prior-session-token";
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_SESSION_COOKIE_NAME ? { value: priorRaw } : undefined,
    } as never);

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-password" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("delete from sessions"),
      [hashSessionToken(priorRaw)],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("user_id = $1::uuid"),
      [userId],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("insert into sessions"),
      expect.arrayContaining([userId]),
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("insert into security_audit_events"),
      expect.arrayContaining([userId, "auth.login", "success"]),
    );
  });

  it("omits fixation-token delete when no session cookie is sent", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-password" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("user_id = $1::uuid"),
      [userId],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into sessions"),
      expect.arrayContaining([userId]),
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("insert into security_audit_events"),
      expect.arrayContaining([userId, "auth.login", "success"]),
    );
  });

  it("returns 400 when the JSON includes unexpected keys", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "correct-password",
        rememberMe: true,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("sets a non-HttpOnly CSRF cookie alongside the HttpOnly session cookie", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "correct-password" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const lines = getSetCookieLines(res);
    const sessionLine = lines.find((l) =>
      l.startsWith(`${AUTH_SESSION_COOKIE_NAME}=`),
    );
    const csrfLine = lines.find((l) => l.startsWith(`${AUTH_CSRF_COOKIE_NAME}=`));
    expect(sessionLine?.toLowerCase()).toContain("httponly");
    expect(csrfLine).toBeTruthy();
    expect(csrfLine?.toLowerCase()).not.toContain("httponly");
  });

  it("looks up users by canonical email when the request uses different casing", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "  U@Test.DEV ",
        password: "correct-password",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(findUserWithPasswordByEmail).toHaveBeenCalledWith(
      expect.anything(),
      "u@test.dev",
    );
  });

  it("returns 413 when Content-Length exceeds the JSON cap", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(defaultAbuseEnvFields.VS_API_JSON_BODY_MAX_AUTH_BYTES + 1),
      },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(query).not.toHaveBeenCalled();
  });
});
