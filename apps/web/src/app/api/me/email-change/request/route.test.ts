import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoistedPool = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => hoistedPool),
    withConsumedStepUpToken: vi.fn(),
    tryInsertSecurityAuditEvent: vi.fn(),
  };
});

const hoistedRequireSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/api/require-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/api/require-session")>();
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

const mailerMocks = vi.hoisted(() => {
  const sendEmailChangeVerification = vi.fn();
  const sendEmailChangeAttemptNotice = vi.fn();
  const getWebTransactionalMailer = vi.fn(() => ({
    sendEmailChangeVerification,
    sendEmailChangeAttemptNotice,
  }));
  return { sendEmailChangeVerification, sendEmailChangeAttemptNotice, getWebTransactionalMailer };
});

vi.mock("@/server/transactional-mailer", () => ({
  getWebTransactionalMailer: mailerMocks.getWebTransactionalMailer,
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    NODE_ENV: "test",
    deployEnv: "test",
    publicAppOrigin: "https://app.test",
    ...defaultAbuseEnvFields,
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

import { tryInsertSecurityAuditEvent, withConsumedStepUpToken } from "@vs/db";
import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/me/email-change/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/me/email-change/request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_ID,
        email: "current@example.test",
        emailVerified: true,
        accountRole: "user",
      },
    });
    hoistedPool.query.mockImplementation((sql: string) => {
      if (sql.includes("select id from users where email")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(withConsumedStepUpToken).mockResolvedValue({
      ok: true,
      value: {
        rawToken: "email-change-raw-token",
        expiresAt: new Date("2026-04-17T00:00:00.000Z"),
      },
    });
    mailerMocks.sendEmailChangeVerification.mockResolvedValue({
      kind: "email_change_verification",
      providerMessageId: "m1",
    });
    mailerMocks.sendEmailChangeAttemptNotice.mockResolvedValue({
      kind: "email_change_attempt_notice",
      providerMessageId: "m2",
    });
  });

  it("returns 400 when new email equals current email", async () => {
    const res = await POST(
      postJson({
        newEmail: "current@example.test",
        stepUpToken: "step-token",
      }),
    );
    expect(res.status).toBe(400);
    expect(withConsumedStepUpToken).not.toHaveBeenCalled();
  });

  it("returns 409 when new email is already registered", async () => {
    hoistedPool.query.mockImplementation((sql: string) => {
      if (sql.includes("select id from users where email")) {
        return Promise.resolve({ rows: [{ id: "other-user-id" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const res = await POST(
      postJson({
        newEmail: "taken@example.test",
        stepUpToken: "step-token",
      }),
    );
    expect(res.status).toBe(409);
    expect(withConsumedStepUpToken).not.toHaveBeenCalled();
  });

  it("returns 403 when step-up consumption fails", async () => {
    vi.mocked(withConsumedStepUpToken).mockResolvedValueOnce({
      ok: false,
      reason: "expired",
    });
    const res = await POST(
      postJson({
        newEmail: "new@example.test",
        stepUpToken: "step-token",
      }),
    );
    expect(res.status).toBe(403);
    expect(mailerMocks.sendEmailChangeVerification).not.toHaveBeenCalled();
  });

  it("sends verification to new address and notice to current address on success", async () => {
    const res = await POST(
      postJson({
        newEmail: "new@example.test",
        stepUpToken: "step-token",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      verificationDispatch?: { status: string };
      noticeDispatch?: { status: string };
    };
    expect(body.ok).toBe(true);
    expect(body.verificationDispatch?.status).toBe("sent");
    expect(body.noticeDispatch?.status).toBe("sent");
    expect(mailerMocks.sendEmailChangeVerification).toHaveBeenCalledWith({
      to: "new@example.test",
      verificationUrl: "https://app.test/verify-email-change?token=email-change-raw-token",
    });
    expect(mailerMocks.sendEmailChangeAttemptNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "current@example.test",
        securitySettingsUrl: "https://app.test/dashboard/settings",
      }),
    );
    expect(tryInsertSecurityAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "account.email_change_request",
        outcome: "success",
        metadata: expect.objectContaining({
          verificationStatus: "sent",
          noticeStatus: "sent",
        }),
      }),
    );
  });

  it("skips mail when transactional mailer is not configured", async () => {
    mailerMocks.getWebTransactionalMailer.mockReturnValueOnce(null);
    const res = await POST(
      postJson({
        newEmail: "new@example.test",
        stepUpToken: "step-token",
      }),
    );
    expect(res.status).toBe(200);
    expect(mailerMocks.sendEmailChangeVerification).not.toHaveBeenCalled();
    expect(tryInsertSecurityAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "account.email_change_request",
        outcome: "failure",
        metadata: expect.objectContaining({
          verificationStatus: "skipped",
          noticeStatus: "skipped",
          verificationSkipReason: "email_not_configured",
          noticeSkipReason: "email_not_configured",
        }),
      }),
    );
  });
});
