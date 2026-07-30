/**
 * VS-76: profiles archive flat-row construction and virtual-list DOM wrapper budget.
 * Run: `npm run profile:archive-rows -w web`
 */
import { performance } from "node:perf_hooks";
import type { DashboardArchiveListen } from "@vs/db";
import { buildArchiveVirtualRows } from "../src/app/dashboard/archive/archive-flat-rows";
import { archiveVirtualDomBudgetSnapshot } from "../src/app/dashboard/archive/archive-virtual-dom-budget";

function fakeListen(played_at: string, listen_id: string): DashboardArchiveListen {
  return {
    listen_id,
    played_at,
    track_id: "t",
    track_title: "Track",
    artist_name: "Artist",
    album_id: null,
    album_title: null,
    listen_source: "lastfm",
    musicbrainz_release_mbid: null,
    lastfm_cover_image_url: null,
  };
}

const N = 50_000;
const listens: DashboardArchiveListen[] = [];
for (let i = 0; i < N; i++) {
  const month = 1 + (i % 12);
  listens.push(fakeListen(`2023-${String(month).padStart(2, "0")}-15T12:00:00.000Z`, `id-${i}`));
}

const t0 = performance.now();
const rows = buildArchiveVirtualRows(listens, true);
const ms = performance.now() - t0;

console.log(
  JSON.stringify(
    {
      listens: N,
      virtual_rows: rows.length,
      build_archive_virtual_rows_ms: Math.round(ms * 100) / 100,
      archive_virtual_dom_budget: archiveVirtualDomBudgetSnapshot(rows.length, 900),
    },
    null,
    2,
  ),
);
