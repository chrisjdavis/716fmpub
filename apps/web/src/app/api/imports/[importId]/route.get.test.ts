import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getImportJobByIdForUser: vi.fn(),
    getPool: vi.fn(() => ({})),
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({})),
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

import { getImportJobByIdForUser } from "@vs/db";
import { GET } from "./route";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USERS_IMPORT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function getRequest(importId: string): Request {
  return new Request(`http://localhost/api/imports/${importId}`);
}

describe("GET /api/imports/[importId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoistedRequireSession.mockResolvedValue({
      ok: true,
      user: {
        id: USER_A,
        email: "a@example.com",
        emailVerified: true,
        accountRole: "user",
      },
    });
  });

  it("returns 404 when the job id exists for another account (repository returns null)", async () => {
    vi.mocked(getImportJobByIdForUser).mockResolvedValueOnce(null);
    const res = await GET(getRequest(OTHER_USERS_IMPORT_ID), {
      params: Promise.resolve({ importId: OTHER_USERS_IMPORT_ID }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(getImportJobByIdForUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: OTHER_USERS_IMPORT_ID,
        userId: USER_A,
        source: "user",
      }),
    );
  });

  it("returns 200 with import when owned by the authenticated user", async () => {
    vi.mocked(getImportJobByIdForUser).mockResolvedValueOnce({
      id: OTHER_USERS_IMPORT_ID,
      user_id: USER_A,
      label: "mine",
      lastfm_username: "lf",
      source: "user",
      stage: "queued",
      error_message: null,
      items_total: null,
      items_processed: 0,
      checkpoint_pages_completed: 0,
      checkpoint_oldest_uts: null,
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-02T00:00:00.000Z",
    });
    const res = await GET(getRequest(OTHER_USERS_IMPORT_ID), {
      params: Promise.resolve({ importId: OTHER_USERS_IMPORT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.import).toMatchObject({
      id: OTHER_USERS_IMPORT_ID,
      label: "mine",
      lastfm_username: "lf",
      source: "user",
      stage: "queued",
    });
  });

  it("returns 400 for a non-uuid import id", async () => {
    const res = await GET(getRequest("not-a-uuid"), {
      params: Promise.resolve({ importId: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
    expect(getImportJobByIdForUser).not.toHaveBeenCalled();
  });

  it("returns 500 JSON when the repository throws (e.g. corrupt row mapping)", async () => {
    vi.mocked(getImportJobByIdForUser).mockRejectedValueOnce(new Error("mapRow failed"));
    const res = await GET(getRequest(OTHER_USERS_IMPORT_ID), {
      params: Promise.resolve({ importId: OTHER_USERS_IMPORT_ID }),
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Invalid import job record" });
  });
});
