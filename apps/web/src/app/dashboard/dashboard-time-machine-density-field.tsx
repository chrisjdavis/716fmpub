"use client";

import { useCallback, useEffect, useRef } from "react";

type Props = Readonly<{
  plays: readonly number[];
  selectedIndex: number;
  /** When `newMusic`, chart uses dark blue instead of brand orange. */
  accentVariant?: "brand" | "newMusic";
}>;

function binMax(plays: readonly number[], binCount: number): number[] {
  if (plays.length === 0 || binCount < 1) {
    return [];
  }
  const out = new Array<number>(binCount).fill(0);
  for (let i = 0; i < plays.length; i += 1) {
    const b = Math.min(binCount - 1, Math.floor((i / plays.length) * binCount));
    const v = plays[i] ?? 0;
    if (v > out[b]!) {
      out[b] = v;
    }
  }
  return out;
}

function parseCssColor(s: string): { r: number; g: number; b: number; a: number } | null {
  const t = s.trim();
  const comma = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(t);
  if (comma) {
    return {
      r: Number(comma[1]),
      g: Number(comma[2]),
      b: Number(comma[3]),
      a: comma[4] !== undefined && comma[4] !== "" ? Number(comma[4]) : 1,
    };
  }
  const space = /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(t);
  if (space) {
    return {
      r: Number(space[1]),
      g: Number(space[2]),
      b: Number(space[3]),
      a: space[4] !== undefined && space[4] !== "" ? Number(space[4]) : 1,
    };
  }
  return null;
}

function mix(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }, t: number) {
  const u = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * u),
    g: Math.round(c1.g + (c2.g - c1.g) * u),
    b: Math.round(c1.b + (c2.b - c1.b) * u),
  };
}

export function DashboardTimeMachineDensityField({
  plays,
  selectedIndex,
  accentVariant = "brand",
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeMutedRef = useRef<HTMLSpanElement>(null);
  const probeBrandRef = useRef<HTMLSpanElement>(null);
  const probeWireRef = useRef<HTMLSpanElement>(null);

  const phaseRef = useRef(0);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const pm = probeMutedRef.current;
    const pb = probeBrandRef.current;
    const pw = probeWireRef.current;
    if (!canvas || !wrap || !pm || !pb || !pw) {
      return;
    }

    const rect = wrap.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const muted =
      parseCssColor(getComputedStyle(pm).color) ?? { r: 136, g: 136, b: 136, a: 1 };
    const brandFallback =
      accentVariant === "newMusic" ? { r: 37, g: 99, b: 235, a: 1 } : { r: 255, g: 87, b: 34, a: 1 };
    const brand = parseCssColor(getComputedStyle(pb).color) ?? brandFallback;
    const wire = parseCssColor(getComputedStyle(pw).borderColor);

    const wireRgb = wire ?? muted;
    const binCount = Math.max(48, Math.min(cssW, Math.floor(cssW * 1.2)));
    const binned = binMax(plays, binCount);
    if (binned.length === 0) {
      return;
    }

    const bMax = Math.max(1, ...binned);
    const padX = 1;
    const padY = 3;
    const bottom = cssH - padY;
    const top = padY + 2;
    const innerH = bottom - top;
    const innerW = cssW - padX * 2;
    const n = binned.length;
    const step = innerW / n;

    ctx.clearRect(0, 0, cssW, cssH);

    const tops: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const t = binned[i]! / bMax;
      const h = t * innerH * 0.92;
      tops.push(bottom - h);
    }

    ctx.beginPath();
    ctx.moveTo(padX, bottom);
    for (let i = 0; i < n; i += 1) {
      const x = padX + (i + 0.5) * step;
      ctx.lineTo(x, tops[i]!);
    }
    ctx.lineTo(padX + innerW, bottom);
    ctx.closePath();
    ctx.fillStyle = `rgb(${brand.r} ${brand.g} ${brand.b} / 0.09)`;
    ctx.fill();

    const barGap = Math.max(0.5, step * 0.18);
    const barW = Math.max(1, step - barGap);
    for (let i = 0; i < n; i += 1) {
      const t = binned[i]! / bMax;
      const col = mix(muted, brand, 0.22 + t * 0.78);
      const x = padX + i * step + barGap * 0.5;
      const y = tops[i]!;
      ctx.fillStyle = `rgb(${col.r} ${col.g} ${col.b} / ${0.2 + t * 0.55})`;
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(x, y, barW, bottom - y, 1);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, barW, bottom - y);
      }
    }

    const idx = Math.max(0, Math.min(plays.length - 1, selectedIndex));
    const selX =
      plays.length <= 1 ? padX + innerW * 0.5 : padX + (idx / (plays.length - 1)) * innerW;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pulse = reduceMotion ? 0 : Math.sin(phaseRef.current) * 0.045;

    ctx.strokeStyle = `rgb(${brand.r} ${brand.g} ${brand.b} / ${0.28 + pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(selX, top - 1);
    ctx.lineTo(selX, bottom + 1);
    ctx.stroke();

    ctx.strokeStyle = `rgb(${wireRgb.r} ${wireRgb.g} ${wireRgb.b} / 0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, bottom + 0.5);
    ctx.lineTo(padX + innerW, bottom + 0.5);
    ctx.stroke();
  }, [plays, selectedIndex, accentVariant]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }

    const ro = new ResizeObserver(() => {
      drawFrame();
    });
    ro.observe(wrap);

    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onReduce = () => {
      drawFrame();
    };
    mqReduce.addEventListener("change", onReduce);

    drawFrame();

    return () => {
      ro.disconnect();
      mqReduce.removeEventListener("change", onReduce);
    };
  }, [drawFrame]);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      drawFrame();
      return;
    }

    let raf = 0;
    const loop = () => {
      phaseRef.current += 0.035;
      drawFrame();
      raf = window.requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        window.cancelAnimationFrame(raf);
        raf = 0;
      } else if (raf === 0) {
        raf = window.requestAnimationFrame(loop);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState === "visible") {
      raf = window.requestAnimationFrame(loop);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [drawFrame]);

  return (
    <div
      ref={wrapRef}
      className="relative isolate h-[52px] w-full overflow-hidden rounded-md border border-hairline bg-surface sm:h-[60px]"
      aria-hidden
    >
      <span
        ref={probeMutedRef}
        className="pointer-events-none absolute left-0 top-0 opacity-0 text-muted"
        aria-hidden
      >
        ·
      </span>
      <span
        ref={probeBrandRef}
        className={
          accentVariant === "newMusic"
            ? "pointer-events-none absolute left-0 top-0 opacity-0 text-[rgb(37_99_235)]"
            : "pointer-events-none absolute left-0 top-0 opacity-0 text-brand"
        }
        aria-hidden
      >
        ·
      </span>
      <span
        ref={probeWireRef}
        className="pointer-events-none absolute left-0 top-0 h-px w-4 border-0 border-t border-wire opacity-0"
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full"
        role="presentation"
      />
    </div>
  );
}
