import { describe, expect, it } from "vitest";
import {
  HOME_BRIEFING_SNAPSHOT_SCHEMA_VERSION,
  parseHomeBriefingSnapshotBodyV1,
} from "./homeBriefingSnapshot.js";

describe("parseHomeBriefingSnapshotBodyV1", () => {
  it("accepts a well-formed v1 body", () => {
    const body = {
      schema_version: HOME_BRIEFING_SNAPSHOT_SCHEMA_VERSION,
      as_of: "2026-04-17T12:00:00.000Z",
      time_zone: "UTC",
      calendar_ymd: "2026-04-17",
      briefing: { scope: "daily" },
    };
    expect(parseHomeBriefingSnapshotBodyV1(body)).toEqual(body);
  });

  it("rejects wrong schema version", () => {
    expect(
      parseHomeBriefingSnapshotBodyV1({
        schema_version: 0,
        as_of: "2026-04-17T12:00:00.000Z",
        time_zone: "UTC",
        calendar_ymd: "2026-04-17",
        briefing: {},
      }),
    ).toBeNull();
  });
});
