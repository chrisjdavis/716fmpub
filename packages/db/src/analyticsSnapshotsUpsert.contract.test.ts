import { describe, expect, it } from "vitest";
import { LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS } from "@vs/domain";
import {
  ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_RETURNING_UPDATED_AT_SQL,
  ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL,
} from "./analyticsSnapshotsUpsert.js";

describe("analytics_snapshots replace upsert ↔ domain semantics", () => {
  it("SQL matches the uniqueness contract documented on LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS", () => {
    expect(ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL.toLowerCase()).toContain(
      "on conflict (user_id, kind)",
    );
    expect(LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS.uniqueness.toLowerCase()).toContain("user_id");
    expect(LAYER1_ANALYTICS_ROW_RECOMPUTE_SEMANTICS.writeIntent).toBe("replace");
  });

  it("RETURNING variant extends the canonical upsert without diverging conflict target", () => {
    expect(ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_RETURNING_UPDATED_AT_SQL.startsWith(
      ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_SQL,
    )).toBe(true);
    expect(ANALYTICS_SNAPSHOTS_REPLACE_UPSERT_RETURNING_UPDATED_AT_SQL.toLowerCase()).toContain(
      "returning updated_at",
    );
  });
});
