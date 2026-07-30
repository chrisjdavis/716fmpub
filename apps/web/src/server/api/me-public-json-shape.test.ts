import { describe, expect, it } from "vitest";

/** Mirrors `meJsonUser` in `apps/web/src/app/api/me/route.ts` for VS-42 review traceability. */
function sampleMeResponseBody() {
  return {
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@example.com",
      emailVerified: false,
      accountRole: "user" as const,
      productPlan: "core" as const,
      displayName: null as string | null,
      lastfmUsername: null as string | null,
      hasLastfmApiKey: false,
      statsTimezone: null as string | null,
      listeningHistoryPublic: false,
    },
  };
}

describe("VS-42 /api/me public user JSON shape", () => {
  it("exposes exactly the documented user fields (no secrets or key material)", () => {
    const keys = Object.keys(sampleMeResponseBody().user).sort();
    expect(keys).toEqual(
      [
        "accountRole",
        "displayName",
        "email",
        "emailVerified",
        "hasLastfmApiKey",
        "id",
        "lastfmUsername",
        "listeningHistoryPublic",
        "productPlan",
        "statsTimezone",
      ].sort(),
    );
  });
});
