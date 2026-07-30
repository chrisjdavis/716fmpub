import Link from "next/link";
import type { TimeMachineExploreNarrativeParagraph } from "@/server/time-machine-explore-narrative";

export function DashboardExploreNarrativeParagraph({
  paragraph,
  className,
}: Readonly<{
  paragraph: TimeMachineExploreNarrativeParagraph;
  className?: string;
}>) {
  return (
    <p className={className}>
      {paragraph.runs.map((r, i) => {
        if (r.type === "plain") {
          return <span key={i}>{r.text}</span>;
        }
        const entityClass =
          "font-medium text-foreground underline decoration-transparent decoration-1 underline-offset-[3px] transition-colors hover:decoration-muted-foreground/50 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--brand-rgb)/0.55)]";
        if (r.href) {
          return (
            <Link key={i} href={r.href} className={`${entityClass} text-foreground`}>
              {r.text}
            </Link>
          );
        }
        return (
          <span key={i} className={entityClass}>
            {r.text}
          </span>
        );
      })}
    </p>
  );
}
