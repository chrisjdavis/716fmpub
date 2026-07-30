/**
 * VS-76: deterministic upper bounds on how many virtual row **wrappers** can be mounted
 * at once for the archive window virtualizer. Used by profiling scripts and unit tests —
 * not a substitute for Lighthouse, but a falsifiable “DOM budget vs naive list” signal.
 *
 * {@link ARCHIVE_LIST_VIRTUAL_OVERSCAN} must match `useWindowVirtualizer` in ArchiveBrowser.
 */
export const ARCHIVE_LIST_VIRTUAL_OVERSCAN = 12;

/** Matches `paddingEnd` passed to `useWindowVirtualizer` for the archive list. */
export const ARCHIVE_LIST_VIRTUAL_PADDING_END = 40;

/**
 * Conservative upper bound on mounted virtual rows for a viewport height (CSS px).
 * Assumes rows are at least `minStepPx` tall (between month estimate 52 and listen 80).
 */
export function upperBoundMountedArchiveVirtualRows(
  viewportHeightPx: number,
  minStepPx: number = 48,
): number {
  const h = Math.max(1, viewportHeightPx);
  const step = Math.max(1, minStepPx);
  const body = Math.ceil(h / step);
  return body + ARCHIVE_LIST_VIRTUAL_OVERSCAN * 2 + 6;
}

export type ArchiveVirtualDomBudgetSnapshot = {
  schema: "vs76_archive_virtual_dom_budget_v1";
  viewport_height_px: number;
  min_step_px: number;
  overscan: number;
  padding_end_px: number;
  mounted_virtual_row_wraps_upper_bound: number;
  flat_row_count: number;
  naive_dom_row_wraps_if_not_virtualized: number;
  reduction_ratio_naive_to_upper_bound: string;
};

/**
 * Snapshot for JSON harnesses (`profile:archive-rows`, `perf:baseline`).
 * Compares `flatRowCount` (rows that would exist in the flat model) to an upper bound on
 * how many virtual row wrappers can be mounted at once for `viewportHeightPx`.
 */
export function archiveVirtualDomBudgetSnapshot(
  flatRowCount: number,
  viewportHeightPx: number = 900,
): ArchiveVirtualDomBudgetSnapshot {
  const mounted = upperBoundMountedArchiveVirtualRows(viewportHeightPx);
  const ratio = flatRowCount / mounted;
  return {
    schema: "vs76_archive_virtual_dom_budget_v1",
    viewport_height_px: viewportHeightPx,
    min_step_px: 48,
    overscan: ARCHIVE_LIST_VIRTUAL_OVERSCAN,
    padding_end_px: ARCHIVE_LIST_VIRTUAL_PADDING_END,
    mounted_virtual_row_wraps_upper_bound: mounted,
    flat_row_count: flatRowCount,
    naive_dom_row_wraps_if_not_virtualized: flatRowCount,
    reduction_ratio_naive_to_upper_bound:
      ratio >= 10 ? `${ratio.toFixed(0)}× fewer mounted wrappers (upper bound)` : `${ratio.toFixed(1)}×`,
  };
}
