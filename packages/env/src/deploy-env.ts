export type DeployEnv = "development" | "staging" | "production" | "test";

export function resolveDeployEnv(data: {
  VS_DEPLOY_ENV?: DeployEnv;
  NODE_ENV: string;
}): DeployEnv {
  if (data.VS_DEPLOY_ENV !== undefined) {
    return data.VS_DEPLOY_ENV;
  }
  if (data.NODE_ENV === "test") {
    return "test";
  }
  if (data.NODE_ENV === "development") {
    return "development";
  }
  return "production";
}

export function isStrictDeployEnv(deploy: DeployEnv): boolean {
  return deploy === "staging" || deploy === "production";
}
