import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "./keys.js";

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

function trimEmptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }
  const t = value.trim();
  return t === "" ? undefined : t;
}

function defaultFlagsForKeys(
  registeredKeys: readonly string[],
): Readonly<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const k of registeredKeys) {
    out[k] = false;
  }
  return out;
}

/**
 * Parses a JSON object of booleans against an explicit allowlist. Used by
 * {@link parseFeatureFlagsFromEnv} and by tests with ad hoc key lists.
 */
export function parseFeatureFlagsJson(
  raw: unknown,
  registeredKeys: readonly string[],
): Readonly<Record<string, boolean>> {
  const trimmed = trimEmptyToUndefined(raw);
  if (trimmed === undefined) {
    return defaultFlagsForKeys(registeredKeys);
  }
  if (typeof trimmed !== "string") {
    throw new Error(
      "[feature-flags] FEATURE_FLAGS must be a JSON object string when set",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("[feature-flags] FEATURE_FLAGS must be valid JSON");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "[feature-flags] FEATURE_FLAGS must be a JSON object (not an array or primitive)",
    );
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  const allowlist = new Set<string>(registeredKeys);

  if (allowlist.size === 0) {
    if (entries.length > 0) {
      throw new Error(
        "[feature-flags] FEATURE_FLAGS contains keys but no flags are registered yet. Add keys to FEATURE_FLAG_KEYS in packages/feature-flags/src/keys.ts first.",
      );
    }
    return defaultFlagsForKeys(registeredKeys);
  }

  const base: Record<string, boolean> = {
    ...defaultFlagsForKeys(registeredKeys),
  };
  const unknown: string[] = [];

  for (const [key, value] of entries) {
    if (!allowlist.has(key)) {
      unknown.push(key);
      continue;
    }
    if (typeof value !== "boolean") {
      throw new Error(
        `[feature-flags] FEATURE_FLAGS["${key}"] must be a boolean, got ${typeof value}`,
      );
    }
    base[key] = value;
  }

  if (unknown.length) {
    throw new Error(
      `[feature-flags] FEATURE_FLAGS contains unknown keys: ${unknown.join(", ")}. Register them in packages/feature-flags/src/keys.ts.`,
    );
  }

  return base;
}

/**
 * Parses `FEATURE_FLAGS` JSON from the environment. Omitted or empty means all
 * registered flags are false. Only keys listed in {@link FEATURE_FLAG_KEYS} may
 * appear in the JSON unless the registry is empty (then the JSON must be `{}`).
 */
export function parseFeatureFlagsFromEnv(raw: unknown): FeatureFlags {
  return parseFeatureFlagsJson(raw, FEATURE_FLAG_KEYS) as FeatureFlags;
}
