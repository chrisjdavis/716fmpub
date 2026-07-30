import { describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const hoistedSession = vi.hoisted(() => ({
  readSessionRawToken: vi.fn(),
  validateSession: vi.fn(),
}));

const hoistedDb = vi.hoisted(() => ({
  getExportJobByIdForUser: vi.fn(),
  computeListenExportArtifactAccess: vi.fn(),
}));

vi.mock("@vs/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vs/db")>();
  return {
    ...actual,
    getPool: vi.fn(() => ({})),
    getExportJobByIdForUser: hoistedDb.getExportJobByIdForUser,
    computeListenExportArtifactAccess: hoistedDb.computeListenExportArtifactAccess,
  };
});

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({
    ...defaultAbuseEnvFields,
    deployEnv: "test",
    EXPORT_ARTIFACTS_DIR: "/tmp/vs-artifacts",
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

import { GET as getExportDownload } from "@/app/api/export/listens/[exportJobId]/download/route";

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXPORT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DELIVERY_TOKEN = "t".repeat(43);

function completedRow() {
  return {
    id: EXPORT_ID,
    userId: USER_A,
    format: "json" as const,
    stage: "completed" as const,
    artifactRelativePath: `${USER_A}/${EXPORT_ID}.zip`,
    artifactExpiresAt: "2099-01-01T00:00:00.000Z",
    artifactDeliveryToken: DELIVERY_TOKEN,
    errorMessage: null,
    bullmqJobId: null,
    itemsProcessed: 1,
    itemsTotal: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("Security regression: export listen download access contracts", () => {
  it("returns 400 when the delivery token query parameter is missing", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({
      user: {
        id: USER_A,
        email: "a@example.com",
        emailVerified: true,
        accountRole: "user",
        productPlan: "core",
      },
    });
    hoistedDb.computeListenExportArtifactAccess.mockReturnValue("available");
    hoistedDb.getExportJobByIdForUser.mockResolvedValue(completedRow());

    const res = await getExportDownload(
      new Request(`http://localhost/api/export/listens/${EXPORT_ID}/download`),
      { params: Promise.resolve({ exportJobId: EXPORT_ID }) },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("export_download_token_required");
  });

  it("returns 403 when the delivery token does not match the stored secret", async () => {
    hoistedSession.readSessionRawToken.mockResolvedValue("opaque-raw");
    hoistedSession.validateSession.mockResolvedValue({
      user: {
        id: USER_A,
        email: "a@example.com",
        emailVerified: true,
        accountRole: "user",
        productPlan: "core",
      },
    });
    hoistedDb.computeListenExportArtifactAccess.mockReturnValue("available");
    hoistedDb.getExportJobByIdForUser.mockResolvedValue(completedRow());

    const wrong = "w".repeat(43);
    const u = new URL(`http://localhost/api/export/listens/${EXPORT_ID}/download`);
    u.searchParams.set("token", wrong);
    const res = await getExportDownload(new Request(u.toString()), {
      params: Promise.resolve({ exportJobId: EXPORT_ID }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("export_download_token_rejected");
  });
});
