const SEGMENTS = 24;

type Props = Readonly<{
  processed: number;
  total: number;
}>;

/**
 * Discrete progress bar; only rendered when `total` is a positive finite number.
 */
export function DashboardSegmentedProgress({ processed, total }: Props) {
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }
  const ratio = Math.min(1, Math.max(0, processed / total));
  const filledCount = Math.round(ratio * SEGMENTS);
  return (
    <div className="flex w-full gap-0.5" aria-hidden>
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 ${i < filledCount ? "bg-display" : "bg-hairline"}`}
        />
      ))}
    </div>
  );
}
