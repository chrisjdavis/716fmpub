import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CSRF_COOKIE_NAME, AUTH_SESSION_COOKIE_NAME } from "@vs/domain";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";
import { API_CSRF_HEADER_NAME } from "@vs/domain";
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

import { cookies } from "next/headers";
import { POST } from "@/app/api/auth/logout/route";

describe("Security regression: POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation((sql: string) => {
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it("destroys the server session when CSRF double-submit matches", async () => {
    const raw = "opaque-test-token";
    const csrf = "csrf-test-token";
    query.mockImplementation((sql: string) => {
      if (sql.includes("delete from sessions") && sql.includes("returning")) {
        return Promise.resolve({ rows: [{ user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] });
      }
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => {
        if (name === AUTH_SESSION_COOKIE_NAME) {
          return { value: raw };
        }
        if (name === AUTH_CSRF_COOKIE_NAME) {
          return { value: csrf };
        }
        return undefined;
      },
    } as never);

    const res = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [API_CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("delete from sessions"),
      [hashSessionToken(raw)],
    );
  });

  it("returns 403 and does not delete the session when CSRF proof is missing", async () => {
    const raw = "opaque-test-token";
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_SESSION_COOKIE_NAME ? { value: raw } : undefined,
    } as never);

    const res = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid or missing CSRF token",
      code: "csrf_invalid",
    });
    expect(query).toHaveBeenCalled();
    const deletes = query.mock.calls.filter((c) =>
      String(c[0]).includes("delete from sessions"),
    );
    expect(deletes).toHaveLength(0);
  });

  it("returns 200 without touching the database when no session cookie is present", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const res = await POST(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });
});
