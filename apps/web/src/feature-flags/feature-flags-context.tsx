"use client";

import type { FeatureFlagKey, FeatureFlags } from "@vs/feature-flags";
import { createContext, useContext } from "react";

const FeatureFlagsContext = createContext<FeatureFlags | null>(null);

export function FeatureFlagsProvider(props: {
  value: FeatureFlags;
  children: React.ReactNode;
}) {
  return (
    <FeatureFlagsContext.Provider value={props.value}>
      {props.children}
    </FeatureFlagsContext.Provider>
  );
}

export function useFeatureFlags(): FeatureFlags {
  const ctx = useContext(FeatureFlagsContext);
  if (!ctx) {
    throw new Error("useFeatureFlags must be used under FeatureFlagsProvider");
  }
  return ctx;
}

export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return useFeatureFlags()[key] ?? false;
}
