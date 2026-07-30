import { CassetteTape } from "lucide-react";

type AppBrandMarkProps = {
  className?: string;
};

/** Cassette mark used beside the product wordmark in headers (replaces the prior brand dot). */
export function AppBrandMark({ className }: AppBrandMarkProps) {
  return (
    <CassetteTape
      aria-hidden
      strokeWidth={1.25}
      className={[
        "size-[calc(0.875rem*1.35*1.2*1.2*1.2*1.15)] shrink-0 text-brand",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
