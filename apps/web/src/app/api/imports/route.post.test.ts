import { DatabaseError } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    countActiveImportJobsForUser: vi.fn(),
    createImportJob: vi.fn(),
    getPool: vi.fn(() => ({ query: hoisted.poolQuery })),
    markImportJobFailed: vi.fn(),
  };
});

const hoisted = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockEnqueue: vi.fn(),
  poolQuery: vi.fn((sql: string) => {
    if (sql.includes("insert into security_audit_events")) {
      return Promise.resolve({ rows: [{ id: "00000000-0000-4000-8000-000000000099" }] });
    }
    return Promise.resolve({ rows: [] });
  }),
}));

vi.mock("@vs/queue", () => ({
  createImportsQueue: vi.fn(() => ({ close: hoisted.mockClose })),
  enqueueImportsJob: hoisted.mockEnqueue,
  IMPORTS_QUEUE_JOB_NAME: { LASTFM_ROWS_IMPORT: "lastfm_rows_import" },
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ ...defaultAbuseEnvFields })),
  isRedisQueuesEnabled: vi.fn(() => true),
}));

const hoistedRequireSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/api/require-session", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/api/require-session")>();
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

import {
  countActiveImportJobsForUser,
  createImportJob,
  markImportJobFailed,
} from "@vs/db";
import { POST } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/imports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_ID,
        email: "u@example.com",
        emailVerified: true,
        accountRole: "user",
      },
    });
    vi.mocked(countActiveImportJobsForUser).mockResolvedValue(0);
    vi.mocked(createImportJob).mockResolvedValue({ id: IMPORT_ID });
    hoisted.mockEnqueue.mockResolvedValue({ id: "bull-9" });
    hoisted.mockClose.mockResolvedValue(undefined);
    vi.mocked(markImportJobFailed).mockResolvedValue(null);
  });

  it("returns 409 when an import is already queued or running", async () => {
    vi.mocked(countActiveImportJobsForUser).mockResolvedValue(1);
    const out = await POST(
      postRequest({ label: "L", lastfmUsername: "lfuser" }),
    );
    expect(out.status).toBe(409);
    expect(createImportJob).not.toHaveBeenCalled();
    expect(hoisted.mockEnqueue).not.toHaveBeenCalled();
  });

  it("allows import when the account email is not verified (OSS)", async () => {
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_ID,
        email: "u@example.com",
        emailVerified: false,
        accountRole: "user",
      },
    });
    const out = await POST(
      postRequest({ label: "L", lastfmUsername: "lfuser" }),
    );
    // Email verification is not gated in the OSS single-user build.
    expect(out.status).not.toBe(403);
  });

  it("returns 400 when the JSON body includes unexpected keys", async () => {
    const out = await POST(
      postRequest({
        label: "L",
        lastfmUsername: "lfuser",
        priority: "high",
      }),
    );
    expect(out.status).toBe(400);
    expect(createImportJob).not.toHaveBeenCalled();
  });

  it("returns 201 with import id and BullMQ job id", async () => {
    const out = await POST(
      postRequest({ label: "L", lastfmUsername: "lfuser" }),
    );
    expect(out.status).toBe(201);
    expect(await out.json()).toEqual({
      import: { id: IMPORT_ID },
      queueJob: { id: "bull-9" },
    });
    expect(hoisted.mockEnqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: "lastfm_rows_import",
        data: { importJobId: IMPORT_ID, userId: USER_ID },
      }),
    );
    expect(hoisted.mockClose).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when createImportJob hits unique_violation (23505)", async () => {
    const dup = new DatabaseError("duplicate key", 10, "error");
    dup.code = "23505";
    vi.mocked(createImportJob).mockRejectedValueOnce(dup);
    const out = await POST(
      postRequest({ label: "L", lastfmUsername: "lfuser" }),
    );
    expect(out.status).toBe(409);
    const body = await out.json();
    expect(body).toMatchObject({ code: "import_already_queued_or_running" });
    expect(hoisted.mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 503, marks import failed, and still closes the queue on enqueue error", async () => {
    hoisted.mockEnqueue.mockRejectedValue(new Error("redis down"));
    const out = await POST(
      postRequest({ label: "L", lastfmUsername: "lfuser" }),
    );
    expect(out.status).toBe(503);
    expect(markImportJobFailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: IMPORT_ID,
        userId: USER_ID,
        errorMessage: expect.stringContaining("BullMQ enqueue failed"),
      }),
    );
    expect(hoisted.mockClose).toHaveBeenCalledTimes(1);
  });
});
