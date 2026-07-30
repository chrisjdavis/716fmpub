import { describe, expect, it } from "vitest";
import {
  ARCHIVE_LIST_VIRTUAL_OVERSCAN,
  archiveVirtualDomBudgetSnapshot,
  upperBoundMountedArchiveVirtualRows,
} from "./archive-virtual-dom-budget";

describe("upperBoundMountedArchiveVirtualRows", () => {
  it("stays small relative to huge flat lists (virtualization DOM budget)", () => {
    const bound900 = upperBoundMountedArchiveVirtualRows(900);
    expect(bound900).toBeLessThan(80);
    expect(bound900).toBeGreaterThan(ARCHIVE_LIST_VIRTUAL_OVERSCAN);
  });
});

describe("archiveVirtualDomBudgetSnapshot", () => {
  it("reports a large reduction ratio for the 50k-row fixture", () => {
    const flatRows = 50_013;
    const s = archiveVirtualDomBudgetSnapshot(flatRows, 900);
    expect(s.schema).toBe("vs76_archive_virtual_dom_budget_v1");
    expect(s.flat_row_count).toBe(flatRows);
    expect(s.naive_dom_row_wraps_if_not_virtualized).toBe(flatRows);
    expect(s.mounted_virtual_row_wraps_upper_bound).toBeLessThan(500);
    const ratio = s.naive_dom_row_wraps_if_not_virtualized / s.mounted_virtual_row_wraps_upper_bound;
    expect(ratio).toBeGreaterThan(100);
  });
});
