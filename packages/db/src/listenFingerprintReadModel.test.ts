import { describe, expect, it } from "vitest";
import { parseListenFingerprintSnapshotBodyV1 } from "./listenFingerprintReadModel.js";

describe("parseListenFingerprintSnapshotBodyV1", () => {
  it("accepts a v1 body", () => {
    const body = {
      schema_version: 1,
      as_of: "2026-04-01T00:00:00.000Z",
      max_played_at: "2026-03-31T12:00:00.000Z",
      listen_count: "42",
    };
    expect(parseListenFingerprintSnapshotBodyV1(body)).toEqual(body);
  });

  it("accepts null max_played_at", () => {
    const body = {
      schema_version: 1,
      as_of: "2026-04-01T00:00:00.000Z",
      max_played_at: null,
      listen_count: "0",
    };
    expect(parseListenFingerprintSnapshotBodyV1(body)).toEqual(body);
  });

  it("rejects wrong schema_version", () => {
    expect(
      parseListenFingerprintSnapshotBodyV1({
        schema_version: 2,
        as_of: "2026-04-01T00:00:00.000Z",
        max_played_at: null,
        listen_count: "0",
      }),
    ).toBeNull();
  });

  it("rejects non-string listen_count", () => {
    expect(
      parseListenFingerprintSnapshotBodyV1({
        schema_version: 1,
        as_of: "2026-04-01T00:00:00.000Z",
        max_played_at: null,
        listen_count: 9,
      }),
    ).toBeNull();
  });
});
