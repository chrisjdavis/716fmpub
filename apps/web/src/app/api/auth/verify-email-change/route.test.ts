import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const changeMocks = vi.hoisted(() => ({
  withConsumedEmailChangeToken: vi.fn(),
  tryInsertSecurityAuditEvent: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  getPool: () => ({ connect: vi.fn() }),
  withConsumedEmailChangeToken: changeMocks.withConsumedEmailChangeToken,
  tryInsertSecurityAuditEvent: changeMocks.tryInsertSecurityAuditEvent,
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
  EmailChangeCompletionBlockedError: class EmailChangeCompletionBlockedError extends Error {
    readonly code = "email_unavailable" as const;
    readonly userId: string;
    constructor(userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
      super("blocked");
      this.userId = userId;
    }
  },
  applyVerifiedEmailChange: vi.fn(),
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    NODE_ENV: "test",
    deployEnv: "test",
    ...defaultAbuseEnvFields,
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

import { POST } from "./route";

const validToken = "z".repeat(43);

describe("POST /api/auth/verify-email-change", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with explicit codes for invalid, expired, and replayed tokens", async () => {
    for (const reason of ["invalid_token", "expired", "replayed"] as const) {
      vi.mocked(changeMocks.withConsumedEmailChangeToken).mockResolvedValueOnce({
        ok: false,
        reason,
      });
      const req = new Request("http://localhost/api/auth/verify-email-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: validToken }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok?: boolean; code?: string; error?: string };
      expect(body.ok).toBe(false);
      expect(body.code).toBe(reason);
      expect(typeof body.error).toBe("string");
    }
    expect(changeMocks.withConsumedEmailChangeToken).toHaveBeenCalledTimes(3);
  });

  it("returns 200 with email when consumption succeeds", async () => {
    vi.mocked(changeMocks.withConsumedEmailChangeToken).mockResolvedValue({
      ok: true,
      value: { email: "new@example.test", userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    const req = new Request("http://localhost/api/auth/verify-email-change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; email?: string };
    expect(body.ok).toBe(true);
    expect(body.email).toBe("new@example.test");
    expect(changeMocks.tryInsertSecurityAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        action: "account.email_change_complete",
        outcome: "success",
      }),
    );
  });

  it("returns 409 when the target email is taken before completion", async () => {
    const { EmailChangeCompletionBlockedError } = await import("@vs/db");
    vi.mocked(changeMocks.withConsumedEmailChangeToken).mockRejectedValue(
      new EmailChangeCompletionBlockedError("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
    );
    const req = new Request("http://localhost/api/auth/verify-email-change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { ok?: boolean; code?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("email_unavailable");
    expect(changeMocks.tryInsertSecurityAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        action: "account.email_change_complete",
        outcome: "denied",
        metadata: { reason: "email_unavailable" },
      }),
    );
  });

  it("returns 400 when the JSON includes unexpected keys", async () => {
    const req = new Request("http://localhost/api/auth/verify-email-change", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, extra: 1 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(changeMocks.withConsumedEmailChangeToken).not.toHaveBeenCalled();
  });
});
