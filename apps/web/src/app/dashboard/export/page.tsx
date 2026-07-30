import { getPool } from "@vs/db";
import { loadServerEnv } from "@vs/env";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "@/server/auth/get-server-session";
import { redirectIfDashboardShellLocked } from "@/server/dashboard-shell-lock";
import { ListenExportStartButton } from "./listen-export-start-button";

const rows = [
  {
    label: "FULL JSON",
    title: "Complete archive in structured format",
    detail:
      "Canonical listening history (newest first) inside a `.zip` as `listens.json` — track, artist, album, and provenance fields.",
    cta: "Download",
    exportFormat: "json" as const,
  },
  {
    label: "FULL CSV",
    title: "Flat export for spreadsheets and analysis",
    detail:
      "Same rows as JSON, delivered as a `.zip` containing `listens.csv` for Excel, Numbers, Google Sheets, or your own tools.",
    cta: "Download",
    exportFormat: "csv" as const,
  },
  {
    label: "FILTERED EXPORT",
    title: "Export a specific range or subset",
    detail: "Choose a time window, source, artist, or content type before exporting.",
    cta: "Configure",
    href: "/dashboard/archive",
  },
] as const;

const trustItems = ["You own your data", "Export anytime", "Delete permanently"] as const;

function ExportRow({
  label,
  title,
  detail,
  cta,
  danger = false,
  href,
  exportFormat,
  showBottomBorder = true,
}: {
  label: string;
  title: string;
  detail: string;
  cta: string;
  danger?: boolean;
  href?: string;
  exportFormat?: "json" | "csv";
  showBottomBorder?: boolean;
}) {
  const labelClass = [
    "font-mono text-label uppercase tracking-[0.28em]",
    danger ? "text-error" : "text-overline",
  ].join(" ");

  const buttonClass = [
    "inline-flex min-w-[160px] items-center justify-center rounded-md border px-4 py-3 font-mono text-caption uppercase tracking-[0.28em] transition-colors no-underline hover:no-underline md:min-w-[180px] md:px-5 md:py-3.5",
    danger
      ? "border-error/50 text-error hover:border-error hover:text-error"
      : "border-wire text-foreground hover:border-foreground hover:bg-display hover:text-canvas",
    href || exportFormat ? "" : "cursor-not-allowed opacity-70",
  ].join(" ");

  const rowBorderClass = showBottomBorder ? "border-b border-hairline" : "";

  return (
    <div className={`flex flex-col gap-4 py-6 md:gap-5 md:py-8 ${rowBorderClass}`}>
      <div className="space-y-1.5">
        <div className={labelClass}>{label}</div>
        <div className="font-sans text-lg leading-snug text-foreground md:text-xl">{title}</div>
        <div className="w-full min-w-0 font-sans text-base leading-relaxed text-muted">{detail}</div>
      </div>
      <div className="self-start">
        {exportFormat ? (
          <ListenExportStartButton format={exportFormat} label={cta} className={buttonClass} />
        ) : href ? (
          <Link href={href} prefetch={false} className={buttonClass}>
            {cta}
          </Link>
        ) : (
          <button type="button" disabled className={buttonClass}>
            {cta}
          </button>
        )}
      </div>
    </div>
  );
}

export default async function ExportPage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login?next=%2Fdashboard%2Fexport");
  }
  const env = loadServerEnv();
  const pool = getPool(env);
  await redirectIfDashboardShellLocked(pool, session);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 px-6 pb-16 pt-8 md:pb-24 md:pt-12">
        <div className="mx-auto flex min-w-0 w-full max-w-app-content flex-col space-y-9 md:space-y-10">
          <section className="space-y-5 md:space-y-6">
            <div className="space-y-3 md:space-y-4">
              <div className="font-mono text-caption uppercase tracking-[0.28em] text-overline">
                EXPORT
              </div>
              <h1 className="w-full min-w-0 font-display text-[2.5rem] leading-[1.05] tracking-tight text-display sm:text-[3rem] md:text-[4.25rem]">
                Take your data with you
              </h1>
              <p className="w-full min-w-0 text-pretty font-sans text-base leading-7 text-foreground md:text-lg md:leading-8">
                Download your full listening history in open formats. Large exports run in the
                background so the app stays responsive.
              </p>
            </div>

            <div className="grid w-full grid-cols-1 gap-3 rounded-md border border-hairline px-4 py-4 text-left sm:grid-cols-3 sm:items-center sm:gap-6 sm:px-6 md:px-8 md:py-4">
              {trustItems.map((item) => (
                <div
                  key={item}
                  className="min-w-0 font-mono text-caption uppercase tracking-[0.12em] text-foreground sm:text-center"
                >
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr] xl:items-start xl:gap-10">
            <div className="min-w-0">
              {rows.map((row, index) => (
                <ExportRow
                  key={row.label}
                  {...row}
                  showBottomBorder={index < rows.length - 1}
                />
              ))}
            </div>

            <aside className="min-w-0 w-full rounded-md border border-hairline p-5 md:p-6 xl:mt-8">
              <div className="font-mono text-label uppercase tracking-[0.28em] text-overline">
                What’s included
              </div>
              <ul className="mt-4 w-full min-w-0 space-y-2.5 font-sans text-base leading-relaxed text-foreground md:space-y-3">
                <li>Raw imported data</li>
                <li>Cleaned listening history</li>
                <li>Timestamps and source metadata</li>
              </ul>
              <p className="mt-5 w-full min-w-0 border-t border-hairline pt-5 font-sans text-sm leading-relaxed text-muted md:text-base">
                How we handle your account and listening history — including exports — is summarized
                in{" "}
                <Link href="/covenant" className="text-interactive underline-offset-2 hover:underline">
                  The Covenant
                </Link>
                .
              </p>
            </aside>
          </section>

          <section className="space-y-4 pt-8 md:space-y-5 md:pt-10">
            <div className="font-mono text-label uppercase tracking-[0.28em] text-overline">
              Account
            </div>
            <ExportRow
              label="DELETE ACCOUNT"
              title="Remove your archive permanently"
              detail="This deletes your archive and account data. This cannot be undone."
              cta="Delete Account"
              danger
              href="/dashboard/settings#settings-deletion"
            />
          </section>
        </div>
      </div>
    </main>
  );
}
