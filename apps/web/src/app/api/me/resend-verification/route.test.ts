/**
 * Handler-focused tests for POST /api/me/resend-verification.
 * Row-level proof that re-issue deletes prior unconsumed token hashes (superseded links
 * become invalid_token) lives in packages/db/src/emailVerificationTokens.integration.test.ts
 * ("replaces prior unconsumed tokens when issuing again").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const resendMocks = vi.hoisted(() => {
  const defaultEnv = () => ({
    NODE_ENV: "test",
    deployEnv: "test",
    publicAppOrigin: "https://app.test",
    ...defaultAbuseEnvFields,
  });
  return {
    issueEmailVerificationToken: vi.fn(),
    loadServerEnv: vi.fn(defaultEnv),
    defaultEnv,
    sendSignupEmailVerification: vi.fn(),
    requireSessionGate: vi.fn(),
  };
});

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({})),
    issueEmailVerificationToken: resendMocks.issueEmailVerificationToken,
  };
});

vi.mock("@/server/api/require-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/api/require-session")>();
  return {
    ...actual,
    requireSession: resendMocks.requireSessionGate,
    withApiSession: async (
      _req: Request,
      run: (ctx: {
        user: import("@/server/auth/session").AuthenticatedUser;
      }) => Promise<Response>,
    ) => {
      const gate = await resendMocks.requireSessionGate();
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
  loadServerEnv: resendMocks.loadServerEnv,
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("@/server/transactional-mailer", () => ({
  getWebTransactionalMailer: vi.fn(() => ({
    sendSignupEmailVerification: resendMocks.sendSignupEmailVerification,
  })),
}));

import { NextResponse } from "next/server";
import { getWebTransactionalMailer } from "@/server/transactional-mailer";
import { POST } from "./route";

const USER_ID = "22222222-2222-4222-8222-222222222222";

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/me/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/me/resend-verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resendMocks.loadServerEnv.mockImplementation(resendMocks.defaultEnv);
    resendMocks.requireSessionGate.mockResolvedValue({
      ok: true,
      user: {
        id: USER_ID,
        email: "pending@example.test",
        emailVerified: false,
        accountRole: "user",
      },
    });
    resendMocks.issueEmailVerificationToken.mockResolvedValue({
      rawToken: "email-verify-raw-token-resend",
      expiresAt: new Date(Date.now() + 60_000),
    });
    resendMocks.sendSignupEmailVerification.mockResolvedValue({
      kind: "signup_email_verification",
      providerMessageId: "stub",
    });
    vi.mocked(getWebTransactionalMailer).mockReturnValue({
      sendSignupEmailVerification: resendMocks.sendSignupEmailVerification,
    } as never);
  });

  it("returns 400 when the session user is already verified", async () => {
    resendMocks.requireSessionGate.mockResolvedValue({
      ok: true,
      user: {
        id: USER_ID,
        email: "done@example.test",
        emailVerified: true,
        accountRole: "user",
      },
    });
    const res = await POST(postJson({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; ok?: boolean };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("already_verified");
    expect(resendMocks.issueEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("returns 400 for unexpected JSON keys", async () => {
    const res = await POST(postJson({ extra: true }));
    expect(res.status).toBe(400);
    expect(resendMocks.issueEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("issues a fresh verification token, sends mail, and returns dispatch without exposing the token", async () => {
    const res = await POST(postJson({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      emailVerificationDispatch?: { status: string };
      token?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.emailVerificationDispatch).toEqual({ status: "sent" });
    expect(body.token).toBeUndefined();
    expect(resendMocks.issueEmailVerificationToken).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
    );
    expect(resendMocks.sendSignupEmailVerification).toHaveBeenCalledWith({
      to: "pending@example.test",
      verificationUrl:
        "https://app.test/verify-email?token=email-verify-raw-token-resend",
    });
  });

  it("each successful resend calls issueEmailVerificationToken again (paired with DB integration tests for hash supersede)", async () => {
    resendMocks.issueEmailVerificationToken
      .mockResolvedValueOnce({
        rawToken: "first-resend-token",
        expiresAt: new Date(Date.now() + 60_000),
      })
      .mockResolvedValueOnce({
        rawToken: "second-resend-token",
        expiresAt: new Date(Date.now() + 60_000),
      });

    await POST(postJson({}));
    await POST(postJson({}));

    expect(resendMocks.issueEmailVerificationToken).toHaveBeenCalledTimes(2);
    expect(resendMocks.sendSignupEmailVerification).toHaveBeenNthCalledWith(1, {
      to: "pending@example.test",
      verificationUrl: "https://app.test/verify-email?token=first-resend-token",
    });
    expect(resendMocks.sendSignupEmailVerification).toHaveBeenNthCalledWith(2, {
      to: "pending@example.test",
      verificationUrl: "https://app.test/verify-email?token=second-resend-token",
    });
  });

  it("returns skipped dispatch when public app origin is missing", async () => {
    resendMocks.loadServerEnv.mockImplementation(() => ({
      ...resendMocks.defaultEnv(),
      publicAppOrigin: undefined,
    }));
    const res = await POST(postJson({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      emailVerificationDispatch?: { status: string; reason?: string };
    };
    expect(body.emailVerificationDispatch).toEqual({
      status: "skipped",
      reason: "public_app_origin_missing",
    });
    expect(resendMocks.sendSignupEmailVerification).not.toHaveBeenCalled();
    expect(resendMocks.issueEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("returns skipped dispatch when transactional mailer is not configured", async () => {
    vi.mocked(getWebTransactionalMailer).mockReturnValue(null);
    const res = await POST(postJson({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      emailVerificationDispatch?: { status: string; reason?: string };
    };
    expect(body.emailVerificationDispatch).toEqual({
      status: "skipped",
      reason: "email_not_configured",
    });
    expect(resendMocks.sendSignupEmailVerification).not.toHaveBeenCalled();
    expect(resendMocks.issueEmailVerificationToken).not.toHaveBeenCalled();
  });

  it("returns failed dispatch on provider errors without throwing", async () => {
    resendMocks.sendSignupEmailVerification.mockRejectedValue(new Error("smtp down"));
    const res = await POST(postJson({}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      emailVerificationDispatch?: { status: string; reason?: string };
    };
    expect(body.emailVerificationDispatch).toEqual({
      status: "failed",
      reason: "provider_error",
    });
    expect(resendMocks.issueEmailVerificationToken).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when the session gate is unauthenticated", async () => {
    resendMocks.requireSessionGate.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    });
    const res = await POST(postJson({}));
    expect(res.status).toBe(401);
    expect(resendMocks.issueEmailVerificationToken).not.toHaveBeenCalled();
  });
});
