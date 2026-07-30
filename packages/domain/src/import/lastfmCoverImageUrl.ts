const SIZE_RANK: Readonly<Record<string, number>> = {
  mega: 0,
  extralarge: 1,
  large: 2,
  medium: 3,
  small: 4,
};

/**
 * Allows only http(s) cover URLs suitable for `<img src>`. Rejects other schemes and
 * malformed values that browsers might reinterpret.
 */
export function sanitizeRemoteCoverImageUrl(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const t = raw.trim();
  if (t === "" || /[\\\s\u0000-\u001f\u007f]/.test(t)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(t);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (!parsed.hostname) {
    return null;
  }
  return parsed.href;
}

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
    const safe = sanitizeRemoteCoverImageUrl(text);
    if (!safe) {
      continue;
    }
    const size = typeof o.size === "string" ? o.size.toLowerCase() : "";
    const rank = SIZE_RANK[size] ?? 5;
    out.push({ url: safe, rank });
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
