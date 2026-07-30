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
import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation((sql: string) => {
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  it("deletes the session row when a session cookie is present", async () => {
    const raw = "opaque-test-token";
    const csrf = "csrf-test-token";
    query.mockImplementation((sql: string) => {
      if (sql.includes("delete from sessions") && sql.includes("returning")) {
        return Promise.resolve({
          rows: [{ user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
        });
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
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("delete from sessions"),
      [hashSessionToken(raw)],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into security_audit_events"),
      expect.arrayContaining([
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "auth.logout",
        "success",
      ]),
    );
  });

  it("does not call the database when no session cookie is sent", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const res = await POST(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );
    expect(res.status).toBe(200);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 403 when session is present but CSRF proof is missing", async () => {
    const raw = "opaque-test-token";
    query.mockImplementation((sql: string) => {
      if (sql.includes("select user_id from sessions")) {
        return Promise.resolve({
          rows: [{ user_id: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" }],
        });
      }
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
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
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("select user_id from sessions"),
      [hashSessionToken(raw)],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("insert into security_audit_events"),
      expect.arrayContaining([
        "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
        "auth.logout",
        "denied",
      ]),
    );
  });

  it("returns 400 for a JSON body with unexpected keys", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const res = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ extra: true }),
      }),
    );
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const res = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
  });
});
