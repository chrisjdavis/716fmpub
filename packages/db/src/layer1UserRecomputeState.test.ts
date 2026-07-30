import { describe, expect, it } from "vitest";
import {
  LAYER1_ACTIVE_SIGNAL_VERSION,
  resolveLayer1UserRecomputeEffectiveStatus,
  shouldSkipLayer1UserEvidenceRecompute,
  type Layer1UserRecomputeStateRow,
} from "./layer1UserRecomputeState.js";

function baseRow(
  overrides: Partial<Layer1UserRecomputeStateRow> = {},
): Layer1UserRecomputeStateRow {
  const t = new Date("2026-01-01T00:00:00.000Z");
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    status: "fresh",
    signalVersion: LAYER1_ACTIVE_SIGNAL_VERSION,
    inputWatermark: t,
    lastEnqueuedAt: t,
    lastStartedAt: t,
    lastSucceededAt: t,
    lastFailedAt: null,
    failureCode: null,
    failureMessage: null,
    consecutiveFailureCount: 0,
    createdAt: t,
    updatedAt: t,
    ...overrides,
  };
}

describe("resolveLayer1UserRecomputeEffectiveStatus", () => {
  it("treats missing row as never_computed", () => {
    expect(
      resolveLayer1UserRecomputeEffectiveStatus(null, {
        currentInputWatermark: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).toBe("never_computed");
  });

  it("returns stale when listen watermark advances beyond stored input_watermark", () => {
    expect(
      resolveLayer1UserRecomputeEffectiveStatus(
        baseRow({ inputWatermark: new Date("2026-01-01T00:00:00.000Z") }),
        { currentInputWatermark: new Date("2026-01-02T00:00:00.000Z") },
      ),
    ).toBe("stale");
  });

  it("returns stale when persisted signal_version differs from active (version bump)", () => {
    const priorRunVersion = `${LAYER1_ACTIVE_SIGNAL_VERSION}:prior-compute`;
    expect(
      resolveLayer1UserRecomputeEffectiveStatus(
        baseRow({ signalVersion: priorRunVersion }),
        {
          currentInputWatermark: new Date("2026-01-01T00:00:00.000Z"),
          activeSignalVersion: LAYER1_ACTIVE_SIGNAL_VERSION,
        },
      ),
    ).toBe("stale");
  });

  it("returns stale when active constant advanced but row still holds prior version", () => {
    expect(
      resolveLayer1UserRecomputeEffectiveStatus(
        baseRow({ signalVersion: `${LAYER1_ACTIVE_SIGNAL_VERSION}x` }),
        { currentInputWatermark: new Date("2026-01-01T00:00:00.000Z") },
      ),
    ).toBe("stale");
  });

  it("returns fresh when watermark and version align", () => {
    const wm = new Date("2026-01-01T00:00:00.000Z");
    expect(
      resolveLayer1UserRecomputeEffectiveStatus(baseRow({ inputWatermark: wm }), {
        currentInputWatermark: wm,
      }),
    ).toBe("fresh");
  });

  it("returns failed_exhausted when persisted row is exhausted", () => {
    expect(
      resolveLayer1UserRecomputeEffectiveStatus(
        baseRow({ status: "failed_exhausted", lastFailedAt: new Date() }),
        { currentInputWatermark: new Date("2026-02-01T00:00:00.000Z") },
      ),
    ).toBe("failed_exhausted");
  });
});

describe("shouldSkipLayer1UserEvidenceRecompute", () => {
  it("returns false when row is null", () => {
    expect(shouldSkipLayer1UserEvidenceRecompute(null, new Date())).toBe(false);
  });

  it("returns false when lastSucceededAt is null", () => {
    expect(
      shouldSkipLayer1UserEvidenceRecompute(
        baseRow({ lastSucceededAt: null, inputWatermark: new Date("2026-01-01T00:00:00.000Z") }),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("returns false for failed status", () => {
    expect(
      shouldSkipLayer1UserEvidenceRecompute(
        baseRow({ status: "failed", lastFailedAt: new Date() }),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("returns false for failed_exhausted status", () => {
    expect(
      shouldSkipLayer1UserEvidenceRecompute(
        baseRow({ status: "failed_exhausted", lastFailedAt: new Date() }),
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("returns true when prior success, version, and watermark align", () => {
    const wm = new Date("2026-01-10T00:00:00.000Z");
    expect(shouldSkipLayer1UserEvidenceRecompute(baseRow({ inputWatermark: wm, status: "queued" }), wm)).toBe(
      true,
    );
  });

  it("returns false when signal_version differs from active even if watermark matches (VS-90)", () => {
    const wm = new Date("2026-01-10T00:00:00.000Z");
    expect(
      shouldSkipLayer1UserEvidenceRecompute(
        baseRow({ inputWatermark: wm, signalVersion: `${LAYER1_ACTIVE_SIGNAL_VERSION}:prior` }),
        wm,
      ),
    ).toBe(false);
  });

  it("returns false when current input watermark advances beyond stored (VS-90)", () => {
    expect(
      shouldSkipLayer1UserEvidenceRecompute(
        baseRow({ inputWatermark: new Date("2026-01-10T00:00:00.000Z") }),
        new Date("2026-01-11T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
