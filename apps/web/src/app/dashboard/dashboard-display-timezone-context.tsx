"use client";

import { createContext, useContext, type ReactNode } from "react";

const DashboardDisplayTimeZoneContext = createContext<string>("UTC");

export function DashboardDisplayTimeZoneProvider({
  value,
  children,
}: Readonly<{ value: string; children: ReactNode }>) {
  return (
    <DashboardDisplayTimeZoneContext.Provider value={value}>
      {children}
    </DashboardDisplayTimeZoneContext.Provider>
  );
}

/** IANA zone used for dashboard instants (matches settings + edge inference in layout). */
export function useDashboardDisplayIanaTimeZone(): string {
  return useContext(DashboardDisplayTimeZoneContext);
}
