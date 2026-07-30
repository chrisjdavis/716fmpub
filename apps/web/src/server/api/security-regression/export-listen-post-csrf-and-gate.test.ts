import { describe, expect, it, vi } from "vitest";
import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";
import { API_UNAUTHENTICATED_BODY } from "@/server/api/api-auth-response";
import { API_CSRF_HEADER_NAME } from "@vs/domain";

const hoistedSession = vi.hoisted(() => ({
  readSessionRawToken: vi.fn(),
  validateSession: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  getPool: vi.fn(() => ({})),
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
    fn(),
}));

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
import { POST as postExportListens } from "@/app/api/export/listens/route";

const USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "a@example.com",
  emailVerified: true,
  accountRole: "user" as const,
  productPlan: "core" as const,
};

describe("Security regression: POST /api/export/listens CSRF and session", () => {
  it("returns 403 when the session is valid but CSRF double-submit is missing on POST", async () => {
    const csrf = "csrf-proof-token";
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({ user: USER });
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_CSRF_COOKIE_NAME ? { value: csrf } : undefined,
    } as never);

    const res = await postExportListens(
      new Request("http://localhost/api/export/listens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "json" }),
      }),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Invalid or missing CSRF token",
      code: "csrf_invalid",
    });
  });

  it("returns 401 before CSRF when there is no session", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue(undefined);
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);

    const res = await postExportListens(
      new Request("http://localhost/api/export/listens", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [API_CSRF_HEADER_NAME]: "ignored-without-session",
        },
        body: JSON.stringify({ format: "json" }),
      }),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual(API_UNAUTHENTICATED_BODY);
  });
});
