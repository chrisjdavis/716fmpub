"use client";

import { coverArtArchiveFrontThumbnailUrl } from "@vs/domain/cover-art-archive-url";
import { useEffect, useMemo, useState } from "react";

const thumbFrame =
  "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-raised";

/** 44×44 archive row thumb (see archive layout spec). */
const thumbFrameSm =
  "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded border border-hairline bg-raised";

/**
 * Square from definite row height: parent should be a CSS grid row (see recent tracks) so
 * `h-full` resolves; width follows via `aspect-square`. Avoid flex-only rows — `h-full` stays 0.
 */
const thumbFrameTall =
  "relative aspect-square h-full min-h-12 w-auto min-w-0 shrink-0 overflow-hidden rounded border border-hairline bg-raised";

/** Eighth note — reads clearly as “music” when cover art is unavailable (24×24 viewBox). */
function MissingAlbumArtIcon({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      className={`text-muted ${className ?? ""}`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <ellipse
        cx={9.15}
        cy={17.35}
        rx={3.35}
        ry={2.6}
        fill="currentColor"
        opacity={0.88}
        transform="rotate(-24 9.15 17.35)"
      />
      <path
        d="M12.55 6.25v9.85"
        stroke="currentColor"
        strokeWidth={1.65}
        strokeLinecap="round"
      />
      <path
        d="M12.55 6.25c3.15 1.35 5.35 0.55 5.35-2.05"
        stroke="currentColor"
        strokeWidth={1.35}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function normalizeHttpUrl(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const t = raw.trim();
  if (t === "" || !/^https?:\/\//i.test(t)) {
    return null;
  }
  return t;
}

function coverCandidateUrls(
  musicbrainzReleaseMbid: string | null,
  lastfmCoverImageUrl: string | null | undefined,
  caaSize: 250 | 500 | 1200,
): readonly string[] {
  const caa = coverArtArchiveFrontThumbnailUrl(musicbrainzReleaseMbid, caaSize);
  const lf = normalizeHttpUrl(lastfmCoverImageUrl ?? null);
  const out: string[] = [];
  if (caa) {
    out.push(caa);
  }
  if (lf && !out.includes(lf)) {
    out.push(lf);
  }
  return out;
}

/**
 * Cover art: Cover Art Archive by release MBID when available, then Last.fm CDN URLs from the
 * import payload when CAA has no front image or MBID is missing. Failed loads advance candidates
 * before showing the placeholder.
 */
export function DashboardCoverThumb({
  musicbrainzReleaseMbid,
  lastfmCoverImageUrl,
  alt,
  tallRow = false,
  rowSize = "md",
}: Readonly<{
  musicbrainzReleaseMbid: string | null;
  /** From `raw_scrobbles.raw_payload` (`extended=1`); used when CAA URL is absent or 404. */
  lastfmCoverImageUrl?: string | null;
  alt: string;
  /** When true, fill row height beside multi-line copy (e.g. recent tracks). */
  tallRow?: boolean;
  /** `sm` = 44px archive row; `md` = 48px dashboard lists. */
  rowSize?: "sm" | "md";
}>) {
  const caaSize: 250 | 500 | 1200 = tallRow ? 500 : rowSize === "sm" ? 250 : 250;
  const candidates = useMemo(
    () => coverCandidateUrls(musicbrainzReleaseMbid, lastfmCoverImageUrl, caaSize),
    [musicbrainzReleaseMbid, lastfmCoverImageUrl, caaSize],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  /** True after the last candidate image fires `onError` (e.g. both CAA and Last.fm 404). */
  const [giveUp, setGiveUp] = useState(false);
  useEffect(() => {
    setActiveIndex(0);
    setGiveUp(false);
  }, [candidates]);

  const src = giveUp ? null : (candidates[activeIndex] ?? null);
  const frameClass = tallRow ? thumbFrameTall : rowSize === "sm" ? thumbFrameSm : thumbFrame;
  const iconClass = rowSize === "sm" ? "size-7 shrink-0 opacity-95" : "size-8 shrink-0 opacity-95";

  if (!src) {
    return (
      <div
        className={
          tallRow ? `${thumbFrameTall} flex items-center justify-center` : frameClass
        }
        role="img"
        aria-label={`No album artwork. ${alt}`}
        title="No album artwork"
      >
        <MissingAlbumArtIcon className={iconClass} />
      </div>
    );
  }

  const onImgError = () => {
    if (activeIndex + 1 < candidates.length) {
      setActiveIndex((i) => i + 1);
    } else {
      setGiveUp(true);
    }
  };

  if (tallRow) {
    return (
      <div className={thumbFrameTall}>
        <img
          key={src}
          src={src}
          alt={alt}
          loading="lazy"
          sizes="(max-width: 640px) 200px, 320px"
          className="absolute inset-0 h-full w-full object-cover"
          onError={onImgError}
        />
      </div>
    );
  }

  const imgPx = rowSize === "sm" ? 44 : 48;
  return (
    <div className={frameClass}>
      <img
        key={src}
        src={src}
        alt={alt}
        loading="lazy"
        width={imgPx}
        height={imgPx}
        className="h-full w-full min-h-0 object-cover"
        onError={onImgError}
      />
    </div>
  );
}
