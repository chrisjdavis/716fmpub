import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAbuseEnvFields } from "@vs/env/abuse-env-fields";

const defaultImportGuidedSteps = [
  {
    id: "lastfm_download" as const,
    title: "Download from Last.fm",
    detail: "Streams your scrobbles and persists raw import batches.",
    status: "pending" as const,
  },
  {
    id: "persist_listens" as const,
    title: "Normalize and store listens",
    detail: "Builds canonical listens plus artist and album records from your history.",
    status: "pending" as const,
  },
  {
    id: "stats_rollups" as const,
    title: "Compute dashboard stats",
    detail: "Fills period, artist, and daily metrics used across charts and summaries.",
    status: "pending" as const,
  },
];

const hoistedPayload = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      state: "not_started" as const,
      canResume: true,
      hasLastfmUsername: false,
      hasLastfmApiKey: false,
      emailVerified: true,
      importStatsProcessingComplete: false,
      importGuidedSteps: defaultImportGuidedSteps,
      importStatus: "none" as const,
      importItemsProcessed: 0,
      importItemsTotal: null,
      importPercent: null,
      importCheckpointPages: 0,
      importPipelineSummary: null,
      importErrorMessage: null,
      listenCount: 0,
      hasUsableArchiveData: false,
      onboardingDeferredAt: null,
      onboardingCompletedAt: null,
    }),
  ),
);

vi.mock("@/server/onboarding-state-response", () => ({
  loadOnboardingStatePayload: hoistedPayload,
}));

vi.mock("@vs/db", () => ({
  getPool: vi.fn(() => ({ query: vi.fn() })),
}));

vi.mock("@vs/env", () => ({
  loadServerEnv: vi.fn(() => ({ ...defaultAbuseEnvFields })),
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

import { GET } from "./route";

const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("GET /api/onboarding/state", () => {
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
  });

  it("returns onboarding payload JSON", async () => {
    const res = await GET(new Request("http://localhost/api/onboarding/state"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      state: "not_started",
      canResume: true,
      hasLastfmUsername: false,
      hasLastfmApiKey: false,
      emailVerified: true,
      importStatsProcessingComplete: false,
      importGuidedSteps: defaultImportGuidedSteps,
      importStatus: "none",
      importItemsProcessed: 0,
      importItemsTotal: null,
      importPercent: null,
      importCheckpointPages: 0,
      importPipelineSummary: null,
      importErrorMessage: null,
      listenCount: 0,
      hasUsableArchiveData: false,
      onboardingDeferredAt: null,
      onboardingCompletedAt: null,
    });
    expect(hoistedPayload).toHaveBeenCalledWith({
      pool: expect.anything(),
      user: {
        id: USER_ID,
        email: "u@example.com",
        emailVerified: true,
        accountRole: "user",
      },
    });
  });
});
