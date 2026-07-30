import { describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";
import { API_UNAUTHENTICATED_BODY } from "@/server/api/api-auth-response";

const hoistedSession = vi.hoisted(() => ({
  readSessionRawToken: vi.fn(),
  validateSession: vi.fn(),
}));

vi.mock("@vs/db", () => ({
  getPool: vi.fn(() => ({})),
  runWithDbPerfContext: async (_ctx: unknown, fn: () => Promise<unknown>) =>
    fn(),
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    ...defaultAbuseEnvFields,
    deployEnv: "test",
  })),
  isStrictDeployEnv: vi.fn(() => false),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: () => undefined,
    } as never),
  ),
}));

vi.mock("@/server/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/session")>();
  return {
    ...actual,
    readSessionRawToken: hoistedSession.readSessionRawToken,
    validateSession: hoistedSession.validateSession,
  };
});

import { GET as getImportJob } from "@/app/api/imports/[importId]/route";
import { POST as postExportListens } from "@/app/api/export/listens/route";
import { GET as getExportJob } from "@/app/api/export/listens/[exportJobId]/route";
import { GET as getExportDownload } from "@/app/api/export/listens/[exportJobId]/download/route";

const JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "t".repeat(43);

async function expectUnauthenticated(res: Response): Promise<void> {
  expect(res.status).toBe(401);
  await expect(res.json()).resolves.toEqual(API_UNAUTHENTICATED_BODY);
}

describe("Security regression: scoped routes use the real session gate (no withApiSession stub)", () => {
  it("returns 401 for GET /api/imports/[importId] when no session cookie is present", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue(undefined);
    const res = await getImportJob(new Request(`http://localhost/api/imports/${JOB_ID}`), {
      params: Promise.resolve({ importId: JOB_ID }),
    });
    await expectUnauthenticated(res);
    expect(hoistedSession.validateSession).not.toHaveBeenCalled();
  });

  it("returns 401 for GET /api/imports/[importId] when validateSession rejects the token (expired, idle, or revoked)", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue(null);
    const res = await getImportJob(new Request(`http://localhost/api/imports/${JOB_ID}`), {
      params: Promise.resolve({ importId: JOB_ID }),
    });
    await expectUnauthenticated(res);
    expect(hoistedSession.validateSession).toHaveBeenCalled();
  });

  it("returns 401 for GET /api/export/listens/[exportJobId] without a valid session", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue(undefined);
    const res = await getExportJob(
      new Request(`http://localhost/api/export/listens/${JOB_ID}`),
      { params: Promise.resolve({ exportJobId: JOB_ID }) },
    );
    await expectUnauthenticated(res);
  });

  it("returns 401 for GET /api/export/listens/[exportJobId]/download without a valid session", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue(undefined);
    const u = new URL(`http://localhost/api/export/listens/${JOB_ID}/download`);
    u.searchParams.set("token", TOKEN);
    const res = await getExportDownload(new Request(u.toString()), {
      params: Promise.resolve({ exportJobId: JOB_ID }),
    });
    await expectUnauthenticated(res);
  });

  it("returns 401 for POST /api/export/listens without a valid session", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue(undefined);
    const res = await postExportListens(
      new Request("http://localhost/api/export/listens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "json" }),
      }),
    );
    await expectUnauthenticated(res);
  });
});
