import type {
  TimeMachineExploreAnchorAlbumRow,
  TimeMachineExploreAnchorTrackRow,
  TimeMachineMonthMetricsRow,
} from "@vs/db";
export type TimeMachineExploreAnchorStripKind = "album" | "track" | "artist";

export type TimeMachineExploreAnchorStripItem = Readonly<{
  kind: TimeMachineExploreAnchorStripKind;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  archiveHref?: string | null;
}>;

export type TimeMachineExploreAnchorStrip = Readonly<{
  label: string;
  subtitle?: string;
  items: readonly TimeMachineExploreAnchorStripItem[];
}>;

/** Max tiles in the Explore “IN ROTATION” strip (after dedupe). */
export const TIME_MACHINE_ANCHOR_STRIP_MAX_ITEMS = 20;

function normArtist(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripDedupeKey(item: Readonly<{ imageUrl: string | null | undefined; albumId: string | null; trackId: string }>): string {
  const u = item.imageUrl?.trim();
  if (u) {
    return `u:${u}`;
  }
  return `a:${item.albumId ?? "x"}:t:${item.trackId}`;
}

function archiveHrefForMonth(monthYyyMm: string): string {
  return `/dashboard/archive?month=${encodeURIComponent(monthYyyMm)}`;
}

function trackToStripItem(
  row: TimeMachineExploreAnchorTrackRow,
  monthYyyMm: string,
): TimeMachineExploreAnchorStripItem {
  return {
    kind: "track",
    title: row.title,
    subtitle: row.artist_name,
    imageUrl: row.lastfm_cover_image_url,
    archiveHref: archiveHrefForMonth(monthYyyMm),
  };
}

function albumToStripItem(
  row: TimeMachineExploreAnchorAlbumRow,
  monthYyyMm: string,
): TimeMachineExploreAnchorStripItem {
  return {
    kind: "album",
    title: row.title,
    subtitle: row.artist_name,
    imageUrl: row.lastfm_cover_image_url,
    archiveHref: archiveHrefForMonth(monthYyyMm),
  };
}

/**
 * Builds up to {@link TIME_MACHINE_ANCHOR_STRIP_MAX_ITEMS} anchor strip items from month charts +
 * rollups, deduped by cover URL / album / track (fewer when data is sparse).
 */
export function buildTimeMachineExploreAnchorStrip(input: Readonly<{
  monthYyyMm: string;
  metrics: TimeMachineMonthMetricsRow;
  topTracks: readonly TimeMachineExploreAnchorTrackRow[];
  topAlbums: readonly TimeMachineExploreAnchorAlbumRow[];
  newArtistsRanked: readonly { name: string; playsInPeriod: number }[];
}>): TimeMachineExploreAnchorStrip | null {
  const { monthYyyMm, metrics, topTracks, topAlbums, newArtistsRanked } = input;
  if (metrics.play_count < 1) {
    return null;
  }
  const used = new Set<string>();
  const items: TimeMachineExploreAnchorStripItem[] = [];

  const pushUnique = (item: TimeMachineExploreAnchorStripItem, key: string): void => {
    if (used.has(key)) {
      return;
    }
    used.add(key);
    items.push(item);
  };

  const topArtistNorm = metrics.top_artist_name ? normArtist(metrics.top_artist_name) : null;

  const firstTrack = topTracks[0];
  if (firstTrack) {
    pushUnique(
      trackToStripItem(firstTrack, monthYyyMm),
      stripDedupeKey({
        imageUrl: firstTrack.lastfm_cover_image_url,
        albumId: firstTrack.album_id,
        trackId: firstTrack.track_id,
      }),
    );
  }

  if (topArtistNorm) {
    const row = topTracks.find((t) => normArtist(t.artist_name) === topArtistNorm && t.track_id !== firstTrack?.track_id);
    if (row) {
      pushUnique(
        trackToStripItem(row, monthYyyMm),
        stripDedupeKey({
          imageUrl: row.lastfm_cover_image_url,
          albumId: row.album_id,
          trackId: row.track_id,
        }),
      );
    }
  }

  const firstAlbum = topAlbums[0];
  if (firstAlbum) {
    pushUnique(
      albumToStripItem(firstAlbum, monthYyyMm),
      stripDedupeKey({
        imageUrl: firstAlbum.lastfm_cover_image_url,
        albumId: firstAlbum.album_id,
        trackId: "",
      }),
    );
  }

  const headNew = newArtistsRanked[0]?.name;
  if (headNew) {
    const nk = normArtist(headNew);
    const row = topTracks.find((t) => normArtist(t.artist_name) === nk);
    if (row) {
      pushUnique(
        trackToStripItem(row, monthYyyMm),
        stripDedupeKey({
          imageUrl: row.lastfm_cover_image_url,
          albumId: row.album_id,
          trackId: row.track_id,
        }),
      );
    }
  }

  const secondAlbum = topAlbums[1];
  if (secondAlbum) {
    pushUnique(
      albumToStripItem(secondAlbum, monthYyyMm),
      stripDedupeKey({
        imageUrl: secondAlbum.lastfm_cover_image_url,
        albumId: secondAlbum.album_id,
        trackId: "",
      }),
    );
  }

  for (const row of topTracks) {
    if (items.length >= TIME_MACHINE_ANCHOR_STRIP_MAX_ITEMS) {
      break;
    }
    pushUnique(
      trackToStripItem(row, monthYyyMm),
      stripDedupeKey({
        imageUrl: row.lastfm_cover_image_url,
        albumId: row.album_id,
        trackId: row.track_id,
      }),
    );
  }
  for (const row of topAlbums) {
    if (items.length >= TIME_MACHINE_ANCHOR_STRIP_MAX_ITEMS) {
      break;
    }
    pushUnique(
      albumToStripItem(row, monthYyyMm),
      stripDedupeKey({
        imageUrl: row.lastfm_cover_image_url,
        albumId: row.album_id,
        trackId: "",
      }),
    );
  }

  if (items.length === 0) {
    return null;
  }

  return {
    label: "IN ROTATION",
    subtitle: "Records and tracks shaping this stretch",
    items: items.slice(0, TIME_MACHINE_ANCHOR_STRIP_MAX_ITEMS),
  };
}

function findTrackCoverForTitle(
  topTracks: readonly TimeMachineExploreAnchorTrackRow[],
  title: string | null,
): TimeMachineExploreAnchorTrackRow | null {
  if (!title) {
    return null;
  }
  const needle = title.trim().toLowerCase();
  return topTracks.find((t) => t.title.trim().toLowerCase() === needle) ?? null;
}

function findFirstTrackForArtist(
  topTracks: readonly TimeMachineExploreAnchorTrackRow[],
  artist: string | null,
): TimeMachineExploreAnchorTrackRow | null {
  if (!artist) {
    return null;
  }
  const n = normArtist(artist);
  return topTracks.find((t) => normArtist(t.artist_name) === n) ?? null;
}

function findFirstAlbumForArtist(
  topAlbums: readonly TimeMachineExploreAnchorAlbumRow[],
  artist: string | null,
): TimeMachineExploreAnchorAlbumRow | null {
  if (!artist) {
    return null;
  }
  const n = normArtist(artist);
  return topAlbums.find((a) => normArtist(a.artist_name) === n) ?? null;
}

function firstNewArtistName(value: string): string | null {
  const t = value.trim();
  if (t.length === 0) {
    return null;
  }
  const andIdx = t.toLowerCase().indexOf(" and ");
  const head = andIdx >= 0 ? t.slice(0, andIdx) : t;
  const comma = head.split(",").map((s) => s.trim()).filter(Boolean);
  return comma[0] ?? null;
}

function pickCoverForModule(
  mod: Readonly<{ tagKey: string; value: string }>,
  input: Readonly<{
    topTracks: readonly TimeMachineExploreAnchorTrackRow[];
    topAlbums: readonly TimeMachineExploreAnchorAlbumRow[];
    topTrackTitle: string | null;
    topArtistName: string | null;
  }>,
): { url: string; alt: string } | null {
  const { topTracks, topAlbums, topTrackTitle, topArtistName } = input;
  if (topTracks.length === 0 && topAlbums.length === 0) {
    return null;
  }
  if (mod.tagKey === "WHAT_STUCK") {
    const byTitle = findTrackCoverForTitle(topTracks, mod.value);
    if (byTitle?.lastfm_cover_image_url) {
      return { url: byTitle.lastfm_cover_image_url, alt: `${byTitle.title} — ${byTitle.artist_name}` };
    }
    const top = topTracks[0];
    if (top?.lastfm_cover_image_url) {
      return { url: top.lastfm_cover_image_url, alt: `${top.title} — ${top.artist_name}` };
    }
    const al = topAlbums[0];
    if (al?.lastfm_cover_image_url) {
      return { url: al.lastfm_cover_image_url, alt: `${al.title} — ${al.artist_name}` };
    }
  }
  if (mod.tagKey === "AT_THE_CENTER") {
    const tr = findFirstTrackForArtist(topTracks, mod.value);
    if (tr?.lastfm_cover_image_url) {
      return { url: tr.lastfm_cover_image_url, alt: `${tr.title} — ${tr.artist_name}` };
    }
    const al = findFirstAlbumForArtist(topAlbums, mod.value);
    if (al?.lastfm_cover_image_url) {
      return { url: al.lastfm_cover_image_url, alt: `${al.title} — ${al.artist_name}` };
    }
  }
  if (mod.tagKey === "NEW_AROUND_HERE") {
    const name = firstNewArtistName(mod.value);
    const tr = findFirstTrackForArtist(topTracks, name);
    if (tr?.lastfm_cover_image_url) {
      return { url: tr.lastfm_cover_image_url, alt: `${tr.title} — ${tr.artist_name}` };
    }
    const tr2 = findFirstTrackForArtist(topTracks, topArtistName);
    if (tr2?.lastfm_cover_image_url) {
      return { url: tr2.lastfm_cover_image_url, alt: `${tr2.title} — ${tr2.artist_name}` };
    }
  }
  const fallback = findTrackCoverForTitle(topTracks, topTrackTitle);
  if (fallback?.lastfm_cover_image_url) {
    return { url: fallback.lastfm_cover_image_url, alt: `${fallback.title} — ${fallback.artist_name}` };
  }
  return null;
}

const ART_ELIGIBLE = ["WHAT_STUCK", "AT_THE_CENTER", "NEW_AROUND_HERE"] as const;

/**
 * Returns a new modules array with at most one `imageUrl` set, following art-eligible priority.
 */
export function applySingleExploreCardArt<T extends Readonly<{ tagKey: string; value: string; tag: string; meta: string }>>(
  modules: readonly T[],
  input: Readonly<{
    topTracks: readonly TimeMachineExploreAnchorTrackRow[];
    topAlbums: readonly TimeMachineExploreAnchorAlbumRow[];
    topTrackTitle: string | null;
    topArtistName: string | null;
  }>,
): Array<T & { imageUrl?: string | null; imageAlt?: string | null }> {
  for (const key of ART_ELIGIBLE) {
    const mod = modules.find((m) => m.tagKey === key);
    if (!mod) {
      continue;
    }
    const picked = pickCoverForModule(mod, input);
    if (!picked) {
      continue;
    }
    return modules.map((m) =>
      m.tagKey === key
        ? { ...m, imageUrl: picked.url, imageAlt: picked.alt }
        : { ...m, imageUrl: undefined, imageAlt: undefined },
    );
  }
  return modules.map((m) => ({ ...m, imageUrl: undefined, imageAlt: undefined }));
}
