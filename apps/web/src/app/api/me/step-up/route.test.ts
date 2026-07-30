import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({})),
    issueStepUpToken: vi.fn(),
  };
});

const hoistedRequireSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/api/require-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/api/require-session")>();
  return {
    ...actual,
    requireSession: hoistedRequireSession,
    withApiSession: async (
      _req: Request,
      run: (ctx: {
        user: import("@/server/auth/session").AuthenticatedUser;
      }) => Promise<Response>,
    ) => {
      const gate = await hoistedRequireSession();
      if (!gate.ok) {
        return gate.response;
      }
      const res = await run({ user: gate.user });
      actual.applySessionRotationToResponse(gate, res);
      return res;
    },
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ ...defaultAbuseEnvFields })),
}));

vi.mock("@/server/auth/user-repository", () => ({
  findUserPasswordHashById: vi.fn(),
}));

vi.mock("@/server/auth/password", () => ({
  verifyPassword: vi.fn(),
}));

import { issueStepUpToken } from "@vs/db";
import { verifyPassword } from "@/server/auth/password";
import { findUserPasswordHashById } from "@/server/auth/user-repository";
import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/me/step-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/me/step-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_ID,
        email: "u@example.com",
        emailVerified: true,
        accountRole: "user",
      },
    });
    vi.mocked(findUserPasswordHashById).mockResolvedValue({ password_hash: "h" });
    vi.mocked(verifyPassword).mockResolvedValue(true);
    vi.mocked(issueStepUpToken).mockResolvedValue({
      rawToken: "opaque-step-up",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
  });

  it("returns 400 for an unknown purpose", async () => {
    const res = await POST(
      postJson({ password: "x", purpose: "unknown_purpose" }),
    );
    expect(res.status).toBe(400);
    expect(issueStepUpToken).not.toHaveBeenCalled();
  });

  it("returns 400 for unexpected keys in the JSON body", async () => {
    const res = await POST(
      postJson({ password: "x", purpose: "purge_listen_data", admin: true }),
    );
    expect(res.status).toBe(400);
    expect(issueStepUpToken).not.toHaveBeenCalled();
  });

  it("returns 401 when the password does not verify", async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);
    const res = await POST(
      postJson({ password: "wrong", purpose: "purge_listen_data" }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("step_up_password_invalid");
    expect(issueStepUpToken).not.toHaveBeenCalled();
  });

  it("returns token metadata on success", async () => {
    const res = await POST(
      postJson({ password: "correct", purpose: "purge_listen_data" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      token?: string;
      purpose?: string;
      ttlMs?: number;
    };
    expect(body.token).toBe("opaque-step-up");
    expect(body.purpose).toBe("purge_listen_data");
    expect(body.ttlMs).toBeGreaterThan(0);
    expect(issueStepUpToken).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      "purge_listen_data",
    );
  });
});
