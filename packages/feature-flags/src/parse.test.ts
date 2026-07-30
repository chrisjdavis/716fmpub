import { describe, expect, it } from "vitest";
import { parseFeatureFlagsFromEnv, parseFeatureFlagsJson } from "./parse.js";

describe("parseFeatureFlagsFromEnv", () => {
  it("treats unset, null, empty string, and whitespace as all registered flags false", () => {
    const allOff = { skipRedisQueues: false, signupsDisabled: false };
    expect(parseFeatureFlagsFromEnv(undefined)).toEqual(allOff);
    expect(parseFeatureFlagsFromEnv(null)).toEqual(allOff);
    expect(parseFeatureFlagsFromEnv("")).toEqual(allOff);
    expect(parseFeatureFlagsFromEnv("   ")).toEqual(allOff);
  });

  it("rejects non-string raw values", () => {
    expect(() => parseFeatureFlagsFromEnv(1)).toThrow(/must be a JSON object string/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseFeatureFlagsFromEnv("{")).toThrow(/valid JSON/);
  });

  it("rejects non-object JSON", () => {
    expect(() => parseFeatureFlagsFromEnv("[]")).toThrow(/JSON object/);
    expect(() => parseFeatureFlagsFromEnv('"x"')).toThrow(/JSON object/);
  });

  it("rejects unknown flag keys", () => {
    expect(() => parseFeatureFlagsFromEnv('{"any": true}')).toThrow(/unknown keys/);
  });

  it("accepts empty object as all registered flags false", () => {
    expect(parseFeatureFlagsFromEnv("{}")).toEqual({
      skipRedisQueues: false,
      signupsDisabled: false,
    });
  });

  it("accepts skipRedisQueues boolean", () => {
    expect(parseFeatureFlagsFromEnv('{"skipRedisQueues": true}')).toEqual({
      skipRedisQueues: true,
      signupsDisabled: false,
    });
  });

  it("accepts signupsDisabled boolean", () => {
    expect(parseFeatureFlagsFromEnv('{"signupsDisabled": true}')).toEqual({
      skipRedisQueues: false,
      signupsDisabled: true,
    });
  });
});

describe("parseFeatureFlagsJson", () => {
  const keys = ["alpha", "beta"] as const;

  it("defaults omitted keys to false", () => {
    expect(parseFeatureFlagsJson(undefined, keys)).toEqual({
      alpha: false,
      beta: false,
    });
  });

  it("merges explicit booleans", () => {
    expect(parseFeatureFlagsJson('{"alpha": true}', keys)).toEqual({
      alpha: true,
      beta: false,
    });
  });

  it("rejects unknown keys", () => {
    expect(() =>
      parseFeatureFlagsJson('{"alpha": true, "gamma": false}', keys),
    ).toThrow(/unknown keys: gamma/);
  });

  it("rejects non-boolean values", () => {
    expect(() => parseFeatureFlagsJson('{"alpha": "yes"}', keys)).toThrow(
      /must be a boolean/,
    );
  });
});
