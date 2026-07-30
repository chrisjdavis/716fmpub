import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const recoveryMocks = vi.hoisted(() => ({
  withConsumedPasswordRecoveryToken: vi.fn(),
}));

const sessionMocks = vi.hoisted(() => ({
  invalidatePriorSessionsForAuthTransition: vi.fn(),
  readSessionRawToken: vi.fn(),
}));

const mailerMocks = vi.hoisted(() => ({
  sendPasswordChangedConfirmation: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
  invalidatePriorSessionsForAuthTransition: sessionMocks.invalidatePriorSessionsForAuthTransition,
  readSessionRawToken: sessionMocks.readSessionRawToken,
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(),
}));

vi.mock("@/server/auth/user-repository", () => ({
  updateUserPasswordHash: vi.fn(),
  findUserEmailById: vi.fn(),
}));

vi.mock("@/server/transactional-mailer", () => ({
  getWebTransactionalMailer: vi.fn(() => ({
    sendPasswordChangedConfirmation: mailerMocks.sendPasswordChangedConfirmation,
  })),
}));

vi.mock("@vs/db", () => ({
  getPool: () => ({ query: vi.fn() }),
  withConsumedPasswordRecoveryToken: recoveryMocks.withConsumedPasswordRecoveryToken,
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
    fn(),
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    NODE_ENV: "test",
    deployEnv: "test",
    ...defaultAbuseEnvFields,
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("@/server/api/auth-abuse-rate-limit", () => ({
  rejectIfAuthAbuseRateLimited: vi.fn(async () => null),
}));

import { hashPassword } from "@/server/auth/password";
import { findUserEmailById, updateUserPasswordHash } from "@/server/auth/user-repository";
import { getWebTransactionalMailer } from "@/server/transactional-mailer";
import { POST } from "./route";

const validToken = "y".repeat(43);

describe("POST /api/auth/recovery/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWebTransactionalMailer).mockReturnValue({
      sendPasswordChangedConfirmation: mailerMocks.sendPasswordChangedConfirmation,
    } as never);
    mailerMocks.sendPasswordChangedConfirmation.mockResolvedValue({
      kind: "password_changed_confirmation",
      providerMessageId: "stub",
    });
  });

  it("returns 400 with code invalid_token for an invalid token", async () => {
    vi.mocked(recoveryMocks.withConsumedPasswordRecoveryToken).mockResolvedValueOnce({
      ok: false,
      reason: "invalid_token",
    });
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "twelve-chars-9" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string; ok?: boolean };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("invalid_token");
    expect(body.error).toContain("not valid");
  });

  it("returns 400 with code expired for an expired token", async () => {
    vi.mocked(recoveryMocks.withConsumedPasswordRecoveryToken).mockResolvedValueOnce({
      ok: false,
      reason: "expired",
    });
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "twelve-chars-9" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string; ok?: boolean };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("expired");
    expect(body.error).toContain("expired");
  });

  it("returns 400 with code replayed for a replayed (already consumed) token", async () => {
    vi.mocked(recoveryMocks.withConsumedPasswordRecoveryToken).mockResolvedValueOnce({
      ok: false,
      reason: "replayed",
    });
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "twelve-chars-9" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string; ok?: boolean };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("replayed");
    expect(body.error).toContain("already used");
  });

  it("returns 400 with code account_not_active when the user account is disabled or suspended", async () => {
    vi.mocked(recoveryMocks.withConsumedPasswordRecoveryToken).mockResolvedValueOnce({
      ok: false,
      reason: "account_not_active",
    });
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "twelve-chars-9" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; code?: string; ok?: boolean };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("account_not_active");
    expect(body.error).toMatch(/disabled or suspended/i);
  });

  it("returns 400 when the new password is shorter than the signup policy minimum", async () => {
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "only-eleven" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; details?: { fieldErrors?: { password?: string[] } } };
    expect(body.error).toBe("Invalid request");
    expect(body.details?.fieldErrors?.password?.length).toBeGreaterThan(0);
    expect(recoveryMocks.withConsumedPasswordRecoveryToken).not.toHaveBeenCalled();
  });

  it("returns 400 when the new password fails the distinct-character policy", async () => {
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "a".repeat(12) }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details?: { fieldErrors?: { password?: string[] } } };
    expect(body.details?.fieldErrors?.password?.length).toBeGreaterThan(0);
    expect(recoveryMocks.withConsumedPasswordRecoveryToken).not.toHaveBeenCalled();
  });

  it("returns 200 when the token is consumed successfully", async () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    vi.mocked(sessionMocks.readSessionRawToken).mockResolvedValue(undefined);
    vi.mocked(hashPassword).mockResolvedValue("argon2id$mock");
    vi.mocked(updateUserPasswordHash).mockResolvedValue(true);
    vi.mocked(findUserEmailById).mockResolvedValue({ email: "holder@example.test" });
    vi.mocked(recoveryMocks.withConsumedPasswordRecoveryToken).mockImplementation(
      async (_pool, _opts, fn) => {
        const client = { query: vi.fn() };
        const value = await fn(client as never, { userId });
        return { ok: true, value };
      },
    );
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "twelve-chars-9" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; message?: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/Password updated/);
    expect(sessionMocks.invalidatePriorSessionsForAuthTransition).toHaveBeenCalledWith(
      expect.anything(),
      { userId, requestSessionRawToken: undefined },
    );
    expect(findUserEmailById).toHaveBeenCalledWith(expect.anything(), userId);
    expect(mailerMocks.sendPasswordChangedConfirmation).toHaveBeenCalledTimes(1);
    const sendArgs = vi.mocked(mailerMocks.sendPasswordChangedConfirmation).mock.calls[0]?.[0] as
      | { to?: string; changedAtIso?: string }
      | undefined;
    expect(sendArgs?.to).toBe("holder@example.test");
    expect(sendArgs?.changedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(sendArgs)).not.toContain("twelve-chars");
  });

  it("skips confirmation mail when transactional mailer is unavailable", async () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    vi.mocked(getWebTransactionalMailer).mockReturnValue(null);
    vi.mocked(sessionMocks.readSessionRawToken).mockResolvedValue(undefined);
    vi.mocked(hashPassword).mockResolvedValue("argon2id$mock");
    vi.mocked(updateUserPasswordHash).mockResolvedValue(true);
    vi.mocked(findUserEmailById).mockResolvedValue({ email: "holder@example.test" });
    vi.mocked(recoveryMocks.withConsumedPasswordRecoveryToken).mockImplementation(
      async (_pool, _opts, fn) => {
        const client = { query: vi.fn() };
        const value = await fn(client as never, { userId });
        return { ok: true, value };
      },
    );
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "twelve-chars-9" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mailerMocks.sendPasswordChangedConfirmation).not.toHaveBeenCalled();
  });

  it("returns 200 and logs when confirmation mail dispatch fails", async () => {
    const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sessionMocks.readSessionRawToken).mockResolvedValue(undefined);
    vi.mocked(hashPassword).mockResolvedValue("argon2id$mock");
    vi.mocked(updateUserPasswordHash).mockResolvedValue(true);
    vi.mocked(findUserEmailById).mockResolvedValue({ email: "holder@example.test" });
    vi.mocked(mailerMocks.sendPasswordChangedConfirmation).mockRejectedValue(new Error("smtp down"));
    vi.mocked(recoveryMocks.withConsumedPasswordRecoveryToken).mockImplementation(
      async (_pool, _opts, fn) => {
        const client = { query: vi.fn() };
        const value = await fn(client as never, { userId });
        return { ok: true, value };
      },
    );
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, password: "twelve-chars-9" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns 400 when the JSON includes unexpected keys", async () => {
    const req = new Request("http://localhost/api/auth/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: validToken,
        password: "twelve-chars-9",
        autoLogin: true,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(recoveryMocks.withConsumedPasswordRecoveryToken).not.toHaveBeenCalled();
  });
});
