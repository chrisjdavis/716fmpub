/**
 * Authenticated cross-account tests: `withApiSession` is stubbed so we can inject user A and assert
 * repository-scoped 404/400 behavior. Unauthenticated 401 gates on the same routes live in
 * `scoped-routes-unauthenticated-session-gate.test.ts` (real `withApiSession`, mocked session reads).
 */
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoistedFs = vi.hoisted(() => ({
  stat: vi.fn(),
  createReadStream: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  stat: hoistedFs.stat,
}));

vi.mock("node:fs", () => ({
  createReadStream: hoistedFs.createReadStream,
}));

const hoistedRequireSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/api/require-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/api/require-session")>();
  return {
    ...actual,
    requireSession: hoistedRequireSession,
    withApiSession: async (
      req: Request,
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

const hoistedDb = vi.hoisted(() => ({
  getImportJobByIdForUser: vi.fn(),
  getExportJobByIdForUser: vi.fn(),
  computeListenExportArtifactAccess: vi.fn(),
  withConsumedStepUpToken: vi.fn(),
  purgeUserListenData: vi.fn(),
  poolQuery: vi.fn((sql: string) => {
    if (sql.includes("insert into security_audit_events")) {
      return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
    }
    return Promise.resolve({ rows: [] });
  }),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({ query: hoistedDb.poolQuery })),
    getImportJobByIdForUser: hoistedDb.getImportJobByIdForUser,
    getExportJobByIdForUser: hoistedDb.getExportJobByIdForUser,
    computeListenExportArtifactAccess: hoistedDb.computeListenExportArtifactAccess,
    withConsumedStepUpToken: hoistedDb.withConsumedStepUpToken,
    purgeUserListenData: hoistedDb.purgeUserListenData,
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    ...defaultAbuseEnvFields,
    EXPORT_ARTIFACTS_DIR: "/tmp/vs-artifacts",
  })),
}));

import { PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE } from "@vs/db";
import { GET as getImportJob } from "@/app/api/imports/[importId]/route";
import { GET as getExportJob } from "@/app/api/export/listens/[exportJobId]/route";
import { GET as getExportDownload } from "@/app/api/export/listens/[exportJobId]/download/route";
import { POST as postListenData } from "@/app/api/me/listen-data/route";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "t".repeat(43);

describe("Security regression: cross-account resource boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_A,
        email: "a@example.com",
        emailVerified: true,
        accountRole: "user",
        productPlan: "core",
      },
    });
    hoistedDb.getImportJobByIdForUser.mockResolvedValue(null);
    hoistedDb.getExportJobByIdForUser.mockResolvedValue(null);
    hoistedFs.stat.mockResolvedValue({ isFile: () => true });
    hoistedFs.createReadStream.mockReturnValue(Readable.from([Buffer.from("PK")]) as never);
    hoistedDb.computeListenExportArtifactAccess.mockReturnValue("available");
  });

  it("GET /api/imports/[importId] returns 404 when the repository scopes the row away from the session user", async () => {
    const res = await getImportJob(new Request(`http://localhost/api/imports/${OTHER_JOB}`), {
      params: Promise.resolve({ importId: OTHER_JOB }),
    });
    expect(res.status).toBe(404);
    expect(hoistedDb.getImportJobByIdForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ jobId: OTHER_JOB, userId: USER_A, source: "user" }),
    );
  });

  it("GET /api/export/listens/[exportJobId] returns 404 when the export belongs to another account", async () => {
    const res = await getExportJob(
      new Request(`http://localhost/api/export/listens/${OTHER_JOB}`),
      { params: Promise.resolve({ exportJobId: OTHER_JOB }) },
    );
    expect(res.status).toBe(404);
    expect(hoistedDb.getExportJobByIdForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ exportJobId: OTHER_JOB, userId: USER_A }),
    );
  });

  it("GET /api/export/listens/[exportJobId]/download returns 404 before artifact checks when the job is not owned", async () => {
    const u = new URL(`http://localhost/api/export/listens/${OTHER_JOB}/download`);
    u.searchParams.set("token", TOKEN);
    const res = await getExportDownload(new Request(u.toString()), {
      params: Promise.resolve({ exportJobId: OTHER_JOB }),
    });
    expect(res.status).toBe(404);
    expect(hoistedDb.computeListenExportArtifactAccess).not.toHaveBeenCalled();
  });
});

describe("Security regression: destructive listen-data confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_A,
        email: "a@example.com",
        emailVerified: true,
        accountRole: "user",
        productPlan: "core",
      },
    });
    hoistedDb.withConsumedStepUpToken.mockResolvedValue({ ok: true, value: {} });
  });

  it("returns 400 when the typed confirmation phrase does not match the server-required phrase", async () => {
    const res = await postListenData(
      new Request("http://localhost/api/me/listen-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmPhrase: "DELETE MY WRONG PHRASE",
          stepUpToken: "step-up-opaque",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(hoistedDb.withConsumedStepUpToken).not.toHaveBeenCalled();
  });

  it("returns 400 when confirmPhrase matches but stepUpToken is absent", async () => {
    const res = await postListenData(
      new Request("http://localhost/api/me/listen-data", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmPhrase: PURGE_USER_LISTEN_DATA_CONFIRM_PHRASE,
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(hoistedDb.withConsumedStepUpToken).not.toHaveBeenCalled();
  });
});
