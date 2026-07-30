import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const query = vi.fn();

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: () => ({ query }),
  };
});

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

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/server/auth/user-repository", () => ({
  findUserWithPasswordByEmail: vi.fn(),
}));

vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));

import { cookies } from "next/headers";
import { findUserWithPasswordByEmail } from "@/server/auth/user-repository";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { POST } from "@/app/api/auth/login/route";

const email = "u@test.dev";
const GENERIC = "Invalid email or password";

function loginBody(overrides: { email?: string; password?: string } = {}) {
  return JSON.stringify({
    email: overrides.email ?? email,
    password: overrides.password ?? "secret",
  });
}

describe("Security regression: POST /api/auth/login rejection contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation((sql: string) => {
      if (sql.includes("insert into security_audit_events")) {
        return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
      }
      return Promise.resolve({ rows: [] });
    });
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);
  });

  it("returns the same generic 401 for an unknown email as for a wrong password", async () => {
    vi.mocked(findUserWithPasswordByEmail).mockResolvedValueOnce(null);
    vi.mocked(hashPassword).mockResolvedValueOnce("ignored-hash");

    const resUnknown = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: loginBody({ email: "missing@test.dev" }),
      }),
    );
    expect(resUnknown.status).toBe(401);
    await expect(resUnknown.json()).resolves.toEqual({ error: GENERIC });
    expect(verifyPassword).not.toHaveBeenCalled();

    vi.mocked(findUserWithPasswordByEmail).mockResolvedValueOnce({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email,
      password_hash: "stored",
      account_role: "user",
    });
    vi.mocked(verifyPassword).mockResolvedValueOnce(false);

    const resBadPw = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: loginBody({ password: "wrong" }),
      }),
    );
    expect(resBadPw.status).toBe(401);
    await expect(resBadPw.json()).resolves.toEqual({ error: GENERIC });
  });

  it("returns 400 for malformed JSON so invalid syntax cannot reach credential checks", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(res.status).toBe(400);
    expect(findUserWithPasswordByEmail).not.toHaveBeenCalled();
  });
});
