import type { DeployEnv } from "@vs/env/deploy-env";
import { isStrictDeployEnv, resolveDeployEnv } from "@vs/env/deploy-env";

export type EdgeTransportContext = {
  deploy: DeployEnv;
  strict: boolean;
  trustProxy: boolean;
  /** Canonical origin when `VS_PUBLIC_APP_ORIGIN` parses; otherwise undefined. */
  publicAppOrigin: string | undefined;
};

/**
 * Reads deploy + transport fields without importing the full `@vs/env` server schema (Edge-safe).
 */
export function readEdgeTransportContext(
  raw: Record<string, string | undefined>,
): EdgeTransportContext {
  const deploy = resolveDeployEnv({
    VS_DEPLOY_ENV: raw.VS_DEPLOY_ENV as DeployEnv | undefined,
    NODE_ENV: raw.NODE_ENV ?? "development",
  });
  const publicRaw = raw.VS_PUBLIC_APP_ORIGIN?.trim();
  let publicAppOrigin: string | undefined;
  if (publicRaw) {
    try {
      publicAppOrigin = new URL(publicRaw).origin;
    } catch {
      publicAppOrigin = undefined;
    }
  }
  return {
    deploy,
    strict: isStrictDeployEnv(deploy),
    trustProxy: raw.VS_TRUST_PROXY_HEADERS === "true",
    publicAppOrigin,
  };
}
