import { DashboardListeningInsightsAdvancedGate } from "./dashboard-listening-insights-advanced-gate";

export function DashboardExploreAdvancedGate({
  statsFoundationPending = false,
}: Readonly<{
  statsFoundationPending?: boolean;
}>) {
  return (
    <DashboardListeningInsightsAdvancedGate variant="explore" statsFoundationPending={statsFoundationPending} />
  );
}
