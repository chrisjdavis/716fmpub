import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";
import {
  API_EMAIL_VERIFICATION_REQUIRED_BODY,
  API_UNAUTHENTICATED_BODY,
} from "@/server/api/api-auth-response";
import { API_CSRF_HEADER_NAME } from "@vs/domain";

const hoistedSession = vi.hoisted(() => ({
  readSessionRawToken: vi.fn(),
  validateSession: vi.fn(),
}));

const hoistedDb = vi.hoisted(() => ({
  getUserProfileFields: vi.fn(),
  updateUserProfileFields: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({ query: hoistedDb.poolQuery })),
    getUserProfileFields: hoistedDb.getUserProfileFields,
    updateUserProfileFields: hoistedDb.updateUserProfileFields,
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    ...defaultAbuseEnvFields,
    deployEnv: "test",
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    readSessionRawToken: hoistedSession.readSessionRawToken,
    validateSession: hoistedSession.validateSession,
  };
});

import { cookies } from "next/headers";
import { GET, PATCH } from "@/app/api/me/route";

const USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "a@example.com",
  emailVerified: true,
  accountRole: "user" as const,
  productPlan: "core" as const,
};

describe("Security regression: /api/me session gate and CSRF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedDb.poolQuery.mockImplementation((sql: string) => {
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    hoistedDb.getUserProfileFields.mockResolvedValue({
      display_name: "Ada",
      lastfm_username: "lf",
      has_lastfm_api_key: false,
      stats_timezone: null,
      listening_history_public: false,
    });
    hoistedDb.updateUserProfileFields.mockResolvedValue(undefined);
  });

  it("returns 401 with a stable contract when no session cookie is present", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue(undefined);
    const res = await GET(new Request("http://localhost/api/me"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual(API_UNAUTHENTICATED_BODY);
    expect(hoistedSession.validateSession).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is not valid in the database (expired, idle, or revoked)", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/api/me"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual(API_UNAUTHENTICATED_BODY);
    expect(hoistedSession.validateSession).toHaveBeenCalled();
  });

  it("GET includes emailVerified from the validated session user", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({
      user: { ...USER, emailVerified: false },
    });
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    const res = await GET(new Request("http://localhost/api/me"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      user: {
        id: USER.id,
        email: USER.email,
        emailVerified: false,
        accountRole: "user",
        productPlan: "core",
        displayName: "Ada",
        lastfmUsername: "lf",
        hasLastfmApiKey: false,
      },
    });
  });

  it("GET productPlan reflects validateSession user (server DB path), not client URL hints", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({
      user: { ...USER, productPlan: "advanced" },
    });
    vi.mocked(cookies).mockResolvedValue({ get: () => undefined } as never);
    const res = await GET(
      new Request("http://localhost/api/me?productPlan=core&plan=enterprise"),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      user: { productPlan: "advanced" },
    });
  });

  it("returns 403 on PATCH when the session is valid but the CSRF double-submit proof is missing", async () => {
    const csrf = "csrf-proof-token";
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({ user: USER });
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_CSRF_COOKIE_NAME ? { value: csrf } : undefined,
    } as never);

    const res = await PATCH(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Ada", lastfmUsername: "lf" }),
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid or missing CSRF token",
      code: "csrf_invalid",
    });
    expect(hoistedDb.updateUserProfileFields).not.toHaveBeenCalled();
  });


  it("allows PATCH when session and matching CSRF header are present", async () => {
    const csrf = "csrf-proof-token";
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({ user: USER });
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_CSRF_COOKIE_NAME ? { value: csrf } : undefined,
    } as never);

    const res = await PATCH(
      new Request("http://localhost/api/me", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [API_CSRF_HEADER_NAME]: csrf,
        },
        body: JSON.stringify({ displayName: "Ada", lastfmUsername: "lf" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(hoistedDb.updateUserProfileFields).toHaveBeenCalled();
  });
});
