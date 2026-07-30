import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoisted = vi.hoisted(() => ({
  mockValidateSession: vi.fn(),
  mockReadSessionRawToken: vi.fn(),
  mockLoadServerEnv: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  getPool: vi.fn(() => ({})),
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
    fn(),
}));

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    readSessionRawToken: hoisted.mockReadSessionRawToken,
    validateSession: hoisted.mockValidateSession,
  };
});

vi.mock("@/server/api/api-csrf-guard", () => ({
  cookieAuthCsrfProofOr403: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: () => hoisted.mockLoadServerEnv(),
}));

import { cookieAuthCsrfProofOr403 } from "@/server/api/api-csrf-guard";
import { withApiSession } from "@/server/api/require-session";

describe("withApiSession strict transport gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.mockReadSessionRawToken.mockResolvedValue("opaque-session");
    hoisted.mockValidateSession.mockResolvedValue({
      user: {
        id: "u1",
        email: "e@e.com",
        emailVerified: true,
        accountRole: "user",
        productPlan: "core",
      },
    });
    hoisted.mockLoadServerEnv.mockReturnValue({
      ...defaultAbuseEnvFields,
      deployEnv: "staging",
      publicAppOrigin: "https://app.example.com",
      trustProxyHeaders: false,
    });
  });

  it("returns invalid_host before CSRF when unsafe Host disagrees in strict tier", async () => {
    const inner = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await withApiSession(
      new Request("https://app.example.com/api/me", {
        method: "PATCH",
        headers: { host: "evil.example.com" },
      }),
      inner,
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe("invalid_host");
    expect(inner).not.toHaveBeenCalled();
    expect(vi.mocked(cookieAuthCsrfProofOr403)).not.toHaveBeenCalled();
  });

  it("does not apply Host binding on safe methods", async () => {
    const inner = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await withApiSession(
      new Request("https://app.example.com/api/me", {
        method: "GET",
        headers: { host: "evil.example.com" },
      }),
      inner,
    );
    expect(res.status).toBe(204);
    expect(inner).toHaveBeenCalled();
  });

  it("allows mismatched Host on unsafe methods when deploy is not strict", async () => {
    hoisted.mockLoadServerEnv.mockReturnValue({
      ...defaultAbuseEnvFields,
      deployEnv: "test",
      publicAppOrigin: undefined,
      trustProxyHeaders: false,
    });
    const inner = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const res = await withApiSession(
      new Request("http://localhost/api/me", {
        method: "POST",
        headers: { host: "localhost:9999" },
      }),
      inner,
    );
    expect(res.status).toBe(204);
    expect(inner).toHaveBeenCalled();
  });
});
