import type { DashboardArchiveListen } from "@vs/db";

export type ArchiveVirtualRow =
  | { type: "month"; monthKey: string; rowKey: string }
  | { type: "listen"; listen: DashboardArchiveListen; rowKey: string }
  | { type: "load-sentinel"; rowKey: string };

function monthKeyUtc(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Flattens month-grouped listens into virtual rows (header + rows per month, newest months first).
 * Optional load sentinel is the last row when `includeLoadSentinel` is true.
 */
export function buildArchiveVirtualRows(
  listens: readonly DashboardArchiveListen[],
  includeLoadSentinel: boolean,
): ArchiveVirtualRow[] {
  const m = new Map<string, DashboardArchiveListen[]>();
  for (const row of listens) {
    const k = monthKeyUtc(row.played_at);
    const g = m.get(k);
    if (g) {
      g.push(row);
    } else {
      m.set(k, [row]);
    }
  }
  const sortedKeys = [...m.keys()].sort((a, b) => b.localeCompare(a));
  const out: ArchiveVirtualRow[] = [];
  for (const monthKey of sortedKeys) {
    out.push({ type: "month", monthKey, rowKey: `m:${monthKey}` });
    const rows = m.get(monthKey)!;
    for (const listen of rows) {
      out.push({ type: "listen", listen, rowKey: `l:${listen.listen_id}` });
    }
  }
  if (includeLoadSentinel) {
    out.push({ type: "load-sentinel", rowKey: "s:more" });
  }
  return out;
}

/** Default row heights for initial layout (CSS: month label block + listen min-height 80px). */
export function estimateArchiveVirtualRowHeight(row: ArchiveVirtualRow | undefined): number {
  if (!row) return 80;
  switch (row.type) {
    case "month":
      return 52;
    case "listen":
      return 80;
    case "load-sentinel":
      return 4;
    default:
      return 80;
  }
}
