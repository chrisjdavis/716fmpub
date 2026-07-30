export type TimeMachineNarrativeEntityKind = "artist" | "track" | "album";

export type TimeMachineNarrativeEntity = Readonly<{
  kind: TimeMachineNarrativeEntityKind;
  label: string;
  href?: string | null;
  imageUrl?: string | null;
}>;

export type TimeMachineExploreNarrativeRun =
  | Readonly<{ type: "plain"; text: string }>
  | Readonly<{
      type: "entity";
      text: string;
      kind: TimeMachineNarrativeEntityKind;
      href?: string | null;
      imageUrl?: string | null;
    }>;

export type TimeMachineExploreNarrativeParagraph = Readonly<{
  runs: readonly TimeMachineExploreNarrativeRun[];
}>;

type EntityCandidate = Readonly<{
  label: string;
  kind: TimeMachineNarrativeEntityKind;
  href?: string | null;
  imageUrl?: string | null;
}>;

function overlaps(a: Readonly<{ start: number; end: number }>, b: Readonly<{ start: number; end: number }>): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Picks non-overlapping entity spans (longest labels first) for inline styling.
 */
export function buildExploreNarrativeParagraph(
  text: string,
  candidates: readonly EntityCandidate[],
): TimeMachineExploreNarrativeParagraph {
  const cleaned = candidates
    .map((c) => ({
      ...c,
      label: c.label.trim(),
    }))
    .filter((c) => c.label.length > 0);
  const sorted = [...cleaned].sort((a, b) => {
    if (b.label.length !== a.label.length) {
      return b.label.length - a.label.length;
    }
    return a.label.localeCompare(b.label);
  });
  const spans: Array<{
    start: number;
    end: number;
    kind: TimeMachineNarrativeEntityKind;
    href?: string | null;
    imageUrl?: string | null;
  }> = [];
  for (const c of sorted) {
    let searchFrom = 0;
    while (searchFrom <= text.length) {
      const idx = text.indexOf(c.label, searchFrom);
      if (idx === -1) {
        break;
      }
      const end = idx + c.label.length;
      const next = { start: idx, end, kind: c.kind, href: c.href, imageUrl: c.imageUrl };
      if (!spans.some((s) => overlaps(s, next))) {
        spans.push(next);
        break;
      }
      searchFrom = idx + 1;
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const runs: TimeMachineExploreNarrativeRun[] = [];
  let cursor = 0;
  for (const s of spans) {
    if (s.start > cursor) {
      runs.push({ type: "plain", text: text.slice(cursor, s.start) });
    }
    runs.push({
      type: "entity",
      text: text.slice(s.start, s.end),
      kind: s.kind,
      href: s.href,
      imageUrl: s.imageUrl,
    });
    cursor = s.end;
  }
  if (cursor < text.length) {
    runs.push({ type: "plain", text: text.slice(cursor) });
  }
  if (runs.length === 0) {
    runs.push({ type: "plain", text });
  }
  return { runs };
}

export function entityCandidatesForExploreMonth(input: Readonly<{
  monthYyyMm: string;
  topArtist: string | null;
  topTrack: string | null;
  topAlbumTitle: string | null;
  newArtistHeadline: string | null;
}>): readonly EntityCandidate[] {
  const { monthYyyMm, topArtist, topTrack, topAlbumTitle, newArtistHeadline } = input;
  const archiveHref = `/dashboard/archive?month=${encodeURIComponent(monthYyyMm)}`;
  const out: EntityCandidate[] = [];
  if (topTrack) {
    out.push({ label: topTrack, kind: "track", href: archiveHref });
  }
  if (topArtist) {
    out.push({ label: topArtist, kind: "artist", href: archiveHref });
  }
  if (topAlbumTitle) {
    out.push({ label: topAlbumTitle, kind: "album", href: archiveHref });
  }
  if (newArtistHeadline) {
    out.push({ label: newArtistHeadline, kind: "artist", href: archiveHref });
  }
  return out;
}

/** Ensures at least one concrete artist or track name appears in the primary narrative. */
export function exploreNarrativePlainText(p: TimeMachineExploreNarrativeParagraph | null): string {
  if (!p) {
    return "";
  }
  return p.runs.map((r) => r.text).join("");
}

export function ensureConcreteMusicInPrimaryNarrative(
  text: string,
  topTrack: string | null,
  topArtist: string | null,
): string {
  const t = text.trim();
  if (t.length === 0) {
    return t;
  }
  const lower = t.toLowerCase();
  const mentionsArtist = topArtist !== null && topArtist.length > 0 && lower.includes(topArtist.toLowerCase());
  const mentionsTrack = topTrack !== null && topTrack.length > 0 && lower.includes(topTrack.toLowerCase());
  if (mentionsArtist || mentionsTrack) {
    return t;
  }
  if (topTrack && topArtist) {
    return `${t} Tracks like ${topTrack} kept surfacing with ${topArtist} in the rotation.`;
  }
  if (topArtist) {
    return `${t} ${topArtist} stayed one of the clearest threads in the log.`;
  }
  if (topTrack) {
    return `${t} ${topTrack} kept looping back in the month’s plays.`;
  }
  return t;
}

