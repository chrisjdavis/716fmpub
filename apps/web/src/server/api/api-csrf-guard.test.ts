import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

import { AUTH_CSRF_COOKIE_NAME } from "@vs/domain";
import { cookies } from "next/headers";
import { cookieAuthCsrfProofOr403 } from "@/server/api/api-csrf-guard";
import { API_CSRF_HEADER_NAME } from "@vs/domain";
import { newCsrfToken } from "@/server/auth/csrf-cookie";

describe("cookieAuthCsrfProofOr403", () => {
  it("returns null for GET regardless of CSRF cookies", async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as never);
    const out = await cookieAuthCsrfProofOr403(
      new Request("http://localhost/api/me", { method: "GET" }),
    );
    expect(out).toBeNull();
  });

  it("returns 403 JSON for POST when CSRF header is missing", async () => {
    const token = newCsrfToken();
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_CSRF_COOKIE_NAME ? { value: token } : undefined,
    } as never);
    const out = await cookieAuthCsrfProofOr403(
      new Request("http://localhost/api/me", { method: "POST" }),
    );
    expect(out?.status).toBe(403);
    await expect(out?.json()).resolves.toEqual({
      error: "Invalid or missing CSRF token",
      code: "csrf_invalid",
    });
  });

  it("returns null for POST when cookie and header match", async () => {
    const token = newCsrfToken();
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) =>
        name === AUTH_CSRF_COOKIE_NAME ? { value: token } : undefined,
    } as never);
    const out = await cookieAuthCsrfProofOr403(
      new Request("http://localhost/api/me", {
        method: "POST",
        headers: { [API_CSRF_HEADER_NAME]: token },
      }),
    );
    expect(out).toBeNull();
  });
});
