import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";
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
import { PATCH } from "@/app/api/me/route";

const USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "a@example.com",
  emailVerified: true,
  accountRole: "user" as const,
  productPlan: "core" as const,
};

function patchWithCsrf(body: unknown): Request {
  const csrf = "csrf-proof-token";
  return new Request("http://localhost/api/me", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      [API_CSRF_HEADER_NAME]: csrf,
    },
    body: JSON.stringify(body),
  });
}

describe("Security regression: PATCH /api/me settings mutation negatives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedDb.poolQuery.mockImplementation((sql: string) => {
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const csrf = "csrf-proof-token";
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({ user: USER });
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_CSRF_COOKIE_NAME ? { value: csrf } : undefined,
    } as never);
  });

  it("returns 400 for unknown JSON keys (no silent ignore)", async () => {
    const res = await PATCH(
      patchWithCsrf({
        displayName: "Ada",
        lastfmUsername: "lf",
        isAdmin: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(hoistedDb.updateUserProfileFields).not.toHaveBeenCalled();
  });

  it("returns 400 when lastfmApiKey is present but shorter than the minimum length", async () => {
    const res = await PATCH(
      patchWithCsrf({
        displayName: "Ada",
        lastfmUsername: "lf",
        lastfmApiKey: "short",
      }),
    );
    expect(res.status).toBe(400);
    expect(hoistedDb.updateUserProfileFields).not.toHaveBeenCalled();
  });

  it("returns 400 when required profile keys are missing", async () => {
    const res = await PATCH(
      patchWithCsrf({
        displayName: "Ada",
      }),
    );
    expect(res.status).toBe(400);
    expect(hoistedDb.updateUserProfileFields).not.toHaveBeenCalled();
  });
});
