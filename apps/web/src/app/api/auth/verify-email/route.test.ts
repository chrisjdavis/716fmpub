import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const verifyMocks = vi.hoisted(() => ({
  withConsumedEmailVerificationToken: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  getPool: () => ({ connect: vi.fn() }),
  withConsumedEmailVerificationToken: verifyMocks.withConsumedEmailVerificationToken,
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    NODE_ENV: "test",
    deployEnv: "test",
    welcomeEmailTrigger: "off" as const,
    ...defaultAbuseEnvFields,
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("@/server/welcome-email-enqueue", () => ({
  enqueueWelcomeEmailIfConfigured: vi.fn(),
}));

import { enqueueWelcomeEmailIfConfigured } from "@/server/welcome-email-enqueue";
import { POST } from "./route";

const validToken = "y".repeat(43);

describe("POST /api/auth/verify-email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 with explicit codes for invalid, expired, and replayed tokens", async () => {
    for (const reason of ["invalid_token", "expired", "replayed"] as const) {
      vi.mocked(verifyMocks.withConsumedEmailVerificationToken).mockResolvedValueOnce({
        ok: false,
        reason,
      });
      const req = new Request("http://localhost/api/auth/verify-email", {
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
      expect(body.error?.length).toBeGreaterThan(8);
    }
    expect(verifyMocks.withConsumedEmailVerificationToken).toHaveBeenCalledTimes(3);
  });

  it("returns 200 with email and newlyVerified when consumption succeeds", async () => {
    vi.mocked(verifyMocks.withConsumedEmailVerificationToken).mockResolvedValue({
      ok: true,
      value: { email: "u@example.test", newlyVerified: true, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    });
    const req = new Request("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      email?: string;
      newlyVerified?: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.email).toBe("u@example.test");
    expect(body.newlyVerified).toBe(true);
    expect(enqueueWelcomeEmailIfConfigured).not.toHaveBeenCalled();
  });

  it("enqueues welcome email when newly verified and VS_WELCOME_EMAIL is email_verified", async () => {
    const { loadServerEnv } = await import("@vs/env");
    vi.mocked(loadServerEnv).mockReturnValueOnce({
      NODE_ENV: "test",
      deployEnv: "test",
      welcomeEmailTrigger: "email_verified",
      ...defaultAbuseEnvFields,
    } as never);
    vi.mocked(verifyMocks.withConsumedEmailVerificationToken).mockResolvedValue({
      ok: true,
      value: {
        email: "u@example.test",
        newlyVerified: true,
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
    const req = new Request("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      email?: string;
      newlyVerified?: boolean;
    };
    expect(body).toMatchObject({
      ok: true,
      email: "u@example.test",
      newlyVerified: true,
    });
    expect(enqueueWelcomeEmailIfConfigured).toHaveBeenCalledTimes(1);
    expect(enqueueWelcomeEmailIfConfigured).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        when: "email_verified",
      }),
    );
  });

  it("does not enqueue welcome email when trigger is signup instead of email_verified", async () => {
    const { loadServerEnv } = await import("@vs/env");
    vi.mocked(loadServerEnv).mockReturnValueOnce({
      NODE_ENV: "test",
      deployEnv: "test",
      welcomeEmailTrigger: "signup",
      ...defaultAbuseEnvFields,
    } as never);
    vi.mocked(verifyMocks.withConsumedEmailVerificationToken).mockResolvedValue({
      ok: true,
      value: {
        email: "u@example.test",
        newlyVerified: true,
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
    const req = new Request("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken }),
    });
    await POST(req);
    expect(enqueueWelcomeEmailIfConfigured).not.toHaveBeenCalled();
  });

  it("does not enqueue welcome email when already verified", async () => {
    const { loadServerEnv } = await import("@vs/env");
    vi.mocked(loadServerEnv).mockReturnValueOnce({
      NODE_ENV: "test",
      deployEnv: "test",
      welcomeEmailTrigger: "email_verified",
      ...defaultAbuseEnvFields,
    } as never);
    vi.mocked(verifyMocks.withConsumedEmailVerificationToken).mockResolvedValue({
      ok: true,
      value: {
        email: "u@example.test",
        newlyVerified: false,
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
    const req = new Request("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken }),
    });
    await POST(req);
    expect(enqueueWelcomeEmailIfConfigured).not.toHaveBeenCalled();
  });

  it("returns 400 when the JSON includes unexpected keys", async () => {
    const req = new Request("http://localhost/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: validToken, csrf: "nope" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(verifyMocks.withConsumedEmailVerificationToken).not.toHaveBeenCalled();
  });
});
