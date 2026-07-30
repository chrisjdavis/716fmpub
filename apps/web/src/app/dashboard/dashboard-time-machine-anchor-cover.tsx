"use client";

import { CassetteTape } from "lucide-react";
import { sanitizeRemoteCoverImageUrl } from "@vs/domain/import/lastfm-cover-image-url";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./dashboard-time-machine-explore.module.css";

export function DashboardTimeMachineAnchorCover({
  imageUrl,
  alt,
}: Readonly<{
  imageUrl: string | null | undefined;
  alt: string;
}>) {
  const safeUrl = useMemo(() => sanitizeRemoteCoverImageUrl(imageUrl), [imageUrl]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Cached images can be `complete` before `onLoad`; opacity gate would stay hidden forever.
  useLayoutEffect(() => {
    setLoaded(false);
    setFailed(false);
    const el = imgRef.current;
    if (!el || !safeUrl) {
      return;
    }
    if (el.complete) {
      if (el.naturalWidth > 0) {
        setLoaded(true);
      } else {
        setFailed(true);
      }
    }
  }, [safeUrl]);

  const showRemote = Boolean(safeUrl) && !failed;
  const pulseWhileLoading = showRemote && !loaded;

  return (
    <div className={styles.anchorCoverFrame}>
      <div
        className={`${styles.anchorCoverPlaceholder} ${styles.anchorCoverPlaceholderFill}${
          pulseWhileLoading ? ` ${styles.anchorCoverPlaceholderPulse}` : ""
        }`}
        aria-hidden
      >
        <CassetteTape
          aria-hidden
          strokeWidth={1.25}
          className={styles.anchorCoverPlaceholderGlyph}
        />
      </div>
      {showRemote && safeUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote Last.fm CDN
        <img
          ref={imgRef}
          src={safeUrl}
          alt={alt}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`${styles.anchorCoverImgLayer} ${loaded ? styles.anchorCoverImgLayerVisible : ""}`}
          loading="eager"
          decoding="async"
        />
      ) : null}
    </div>
  );
}
