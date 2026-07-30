import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const recoveryMocks = vi.hoisted(() => ({
  issuePasswordRecoveryToken: vi.fn(),
  defaultEnv: () => ({
    NODE_ENV: "test",
    deployEnv: "test",
    publicAppOrigin: "https://app.test",
    ...defaultAbuseEnvFields,
  }),
  sendPasswordReset: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  getPool: () => ({ query: vi.fn() }),
  issuePasswordRecoveryToken: recoveryMocks.issuePasswordRecoveryToken,
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
    fn(),
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(recoveryMocks.defaultEnv),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("@/server/auth/user-repository", () => ({
  findUserWithPasswordByEmail: vi.fn(),
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(),
}));

vi.mock("@/server/transactional-mailer", () => ({
  getWebTransactionalMailer: vi.fn(() => ({
    sendPasswordReset: recoveryMocks.sendPasswordReset,
  })),
}));

import { getWebTransactionalMailer } from "@/server/transactional-mailer";
import { findUserWithPasswordByEmail } from "@/server/auth/user-repository";
import { hashPassword } from "@/server/auth/password";
import { loadServerEnv } from "@vs/env";
import { POST } from "./route";

describe("POST /api/auth/recovery/request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadServerEnv).mockImplementation(recoveryMocks.defaultEnv);
    vi.mocked(getWebTransactionalMailer).mockReturnValue({
      sendPasswordReset: recoveryMocks.sendPasswordReset,
    } as never);
    recoveryMocks.sendPasswordReset.mockResolvedValue({
      kind: "password_reset",
      providerMessageId: "stub",
    });
  });

  it("returns 200 { ok: true } without issuing a token when the email is unknown", async () => {
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValue(null);
    vi.mocked(hashPassword).mockResolvedValue("dummy");

    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "missing@test.dev" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recoveryMocks.issuePasswordRecoveryToken).not.toHaveBeenCalled();
    expect(recoveryMocks.sendPasswordReset).not.toHaveBeenCalled();
    expect(hashPassword).toHaveBeenCalledTimes(1);
  });

  it("returns the same response for unknown and existing accounts when outbound email cannot be sent", async () => {
    vi.mocked(getWebTransactionalMailer).mockReturnValue(null);
    vi.mocked(hashPassword).mockResolvedValue("dummy-timing");

    vi.mocked(findUserWithPasswordByEmail).mockResolvedValueOnce(null);
    const unknownRes = await POST(
      new Request("http://localhost/api/auth/recovery/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ghost@test.dev" }),
      }),
    );

    vi.mocked(findUserWithPasswordByEmail).mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "exists@test.dev",
      password_hash: "x",
      account_role: "user",
    });
    const existsRes = await POST(
      new Request("http://localhost/api/auth/recovery/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "exists@test.dev" }),
      }),
    );

    expect(unknownRes.status).toBe(200);
    expect(existsRes.status).toBe(200);
    expect(await unknownRes.json()).toEqual(await existsRes.json());
    expect(recoveryMocks.issuePasswordRecoveryToken).not.toHaveBeenCalled();
    expect(recoveryMocks.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("issues a token and sends password reset mail when the account exists and email is configured", async () => {
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "exists@test.dev",
      password_hash: "x",
      account_role: "user",
    });
    vi.mocked(recoveryMocks.issuePasswordRecoveryToken).mockResolvedValue({
      rawToken: "recovery-raw-token",
      expiresAt: new Date(),
    });

    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "exists@test.dev" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recoveryMocks.issuePasswordRecoveryToken).toHaveBeenCalledTimes(1);
    expect(hashPassword).not.toHaveBeenCalled();
    expect(recoveryMocks.sendPasswordReset).toHaveBeenCalledWith({
      to: "exists@test.dev",
      recoveryUrl: "https://app.test/reset-password?token=recovery-raw-token",
    });
  });

  it("does not issue a token when the mailer or public origin is unavailable, but still returns { ok: true }", async () => {
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "exists@test.dev",
      password_hash: "x",
      account_role: "user",
    });
    vi.mocked(loadServerEnv).mockImplementation(() => ({
      ...recoveryMocks.defaultEnv(),
      publicAppOrigin: undefined,
    }));
    vi.mocked(hashPassword).mockResolvedValue("dummy");

    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "exists@test.dev" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recoveryMocks.issuePasswordRecoveryToken).not.toHaveBeenCalled();
    expect(recoveryMocks.sendPasswordReset).not.toHaveBeenCalled();
    expect(hashPassword).toHaveBeenCalledTimes(1);
  });

  it("does not issue a token when transactional mailer is not configured", async () => {
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "exists@test.dev",
      password_hash: "x",
      account_role: "user",
    });
    vi.mocked(getWebTransactionalMailer).mockReturnValue(null);
    vi.mocked(hashPassword).mockResolvedValue("dummy");

    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "exists@test.dev" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recoveryMocks.issuePasswordRecoveryToken).not.toHaveBeenCalled();
    expect(recoveryMocks.sendPasswordReset).not.toHaveBeenCalled();
    expect(hashPassword).toHaveBeenCalledTimes(1);
  });

  it("returns the same JSON body on provider send failure without leaking account state", async () => {
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "exists@test.dev",
      password_hash: "x",
      account_role: "user",
    });
    vi.mocked(recoveryMocks.issuePasswordRecoveryToken).mockResolvedValue({
      rawToken: "opaque",
      expiresAt: new Date(),
    });
    recoveryMocks.sendPasswordReset.mockRejectedValue(new Error("smtp down"));

    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "exists@test.dev" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recoveryMocks.issuePasswordRecoveryToken).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for invalid email format", async () => {
    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("Invalid request");
    expect(findUserWithPasswordByEmail).not.toHaveBeenCalled();
  });

  it("returns 400 when the JSON includes unexpected keys", async () => {
    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.co", force: true }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(findUserWithPasswordByEmail).not.toHaveBeenCalled();
  });

  it("looks up accounts using canonical email when the body uses mixed case", async () => {
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "exists@test.dev",
      password_hash: "x",
      account_role: "user",
    });
    vi.mocked(recoveryMocks.issuePasswordRecoveryToken).mockResolvedValue({
      rawToken: "recovery-raw-token",
      expiresAt: new Date(),
    });

    const req = new Request("http://localhost/api/auth/recovery/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "  EXISTS@Test.dev " }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(findUserWithPasswordByEmail).toHaveBeenCalledWith(
      expect.anything(),
      "exists@test.dev",
    );
    expect(recoveryMocks.sendPasswordReset).toHaveBeenCalledWith({
      to: "exists@test.dev",
      recoveryUrl: "https://app.test/reset-password?token=recovery-raw-token",
    });
  });
});
