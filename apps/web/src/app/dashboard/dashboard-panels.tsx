import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import type { DashboardPageBody } from "@/server/dashboard-page-data";
import { DashboardExplorePanels } from "./dashboard-explore-panels";
import { PanelHeader } from "./dashboard-panel-header";

export type DashboardPanelsProps =
  | {
      body: Extract<DashboardPageBody, { kind: "completed" }>;
      profileLastfmUsername: string | null;
      statsFoundationPending?: boolean;
      recentTracksSlot: ReactNode;
    }
  | {
      body: Exclude<DashboardPageBody, { kind: "completed" }>;
      profileLastfmUsername: string | null;
    };

function DashboardImportJobPanelsLoading() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="rounded-md border border-hairline bg-surface px-6 py-8"
    >
      <p className="font-mono text-caption uppercase tracking-[0.08em] text-overline">
        Loading import status…
      </p>
    </div>
  );
}

/** Non-`completed` bodies only; keeps import-job UI out of the static graph for the happy path. */
const DashboardImportJobPanels = dynamic(
  () =>
    import("./dashboard-import-panels").then((m) => ({ default: m.DashboardImportJobPanels })),
  { loading: DashboardImportJobPanelsLoading },
);

export { PanelHeader } from "./dashboard-panel-header";

export function DashboardPanels(props: Readonly<DashboardPanelsProps>) {
  const { body, profileLastfmUsername } = props;
  if (body.kind === "empty") {
    return (
      <div className="flex flex-col gap-16 md:gap-24">
        <PanelHeader kicker="Import" title="No active import" />
        <DashboardImportJobPanels body={body} profileLastfmUsername={profileLastfmUsername} />
      </div>
    );
  }

  if (body.kind === "in_progress") {
    return (
      <div className="flex flex-col gap-16 md:gap-24">
        <PanelHeader kicker="Import" title="In progress" />
        <DashboardImportJobPanels body={body} profileLastfmUsername={profileLastfmUsername} />
      </div>
    );
  }

  if (body.kind === "failed") {
    return (
      <div className="flex flex-col gap-16 md:gap-24">
        <PanelHeader kicker="Import" title="Failed" />
        <DashboardImportJobPanels body={body} profileLastfmUsername={profileLastfmUsername} />
      </div>
    );
  }

  const completedProps = props as Extract<DashboardPanelsProps, { body: { kind: "completed" } }>;
  const { recentTracksSlot, statsFoundationPending } = completedProps;

  return (
    <DashboardExplorePanels
      body={body}
      recentTracksSlot={recentTracksSlot}
      statsFoundationPending={statsFoundationPending}
    />
  );
}
