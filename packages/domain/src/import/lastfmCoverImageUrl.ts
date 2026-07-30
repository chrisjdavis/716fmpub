const SIZE_RANK: Readonly<Record<string, number>> = {
  mega: 0,
  extralarge: 1,
  large: 2,
  medium: 3,
  small: 4,
};

function collectImageCandidates(imageField: unknown, out: { url: string; rank: number }[]): void {
  const list = Array.isArray(imageField)
    ? imageField
    : imageField !== undefined && imageField !== null
      ? [imageField]
      : [];
  for (const el of list) {
    if (!el || typeof el !== "object") {
      continue;
    }
    const o = el as Record<string, unknown>;
    const hashText = o["#text"];
    const text =
      typeof hashText === "string"
        ? hashText.trim()
        : typeof o.url === "string"
          ? o.url.trim()
          : "";
    if (text === "" || !/^https?:\/\//i.test(text)) {
      continue;
    }
    const size = typeof o.size === "string" ? o.size.toLowerCase() : "";
    const rank = SIZE_RANK[size] ?? 5;
    out.push({ url: text, rank });
  }
}

/**
 * Picks the largest Last.fm image URL from a `user.getrecenttracks` track object (JSON), matching
 * how the worker stores `raw_scrobbles.raw_payload`. Prefers {@link https://www.last.fm/api/show/user.getRecentTracks}
 * album-level `image[]`, then track-level `image[]`.
 */
export function lastfmPreferredCoverImageUrlFromWirePayload(payload: unknown): string | null {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const candidates: { url: string; rank: number }[] = [];
  const album = root.album;
  if (album !== null && album !== undefined && typeof album === "object") {
    collectImageCandidates((album as Record<string, unknown>).image, candidates);
  }
  collectImageCandidates(root.image, candidates);
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.url ?? null;
}
