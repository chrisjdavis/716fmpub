import { describe, expect, it } from "vitest";
import {
  assertTransitionSecurityFindingState,
  canTransitionSecurityFindingState,
  isTerminalSecurityFindingState,
  parseSecurityFindingState,
} from "./securityFindingLifecycle.js";

describe("securityFindingLifecycle", () => {
  it("treats closed as terminal for lifecycle helpers", () => {
    expect(isTerminalSecurityFindingState("closed")).toBe(true);
    expect(isTerminalSecurityFindingState("fix-submitted")).toBe(false);
  });

  it("allows normal promotion and remediation path with identity", () => {
    expect(
      canTransitionSecurityFindingState("candidate", "triage"),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState("triage", "confirmed"),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState(
        "confirmed",
        "ready-for-remediation",
      ),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState(
        "ready-for-remediation",
        "fix-submitted",
      ),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("ready-for-remediation", "fix-submitted", {
        fixSubmissionEvidenceRecorded: true,
      }),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState("fix-submitted", "fix-submitted"),
    ).toBe(true);
  });

  it("blocks premature closure from candidate or confirmed", () => {
    expect(canTransitionSecurityFindingState("candidate", "closed")).toBe(
      false,
    );
    expect(canTransitionSecurityFindingState("confirmed", "closed")).toBe(
      false,
    );
    expect(
      canTransitionSecurityFindingState("ready-for-remediation", "closed"),
    ).toBe(false);
  });

  it("requires retest and regression evidence to close from fix-submitted", () => {
    expect(
      canTransitionSecurityFindingState("fix-submitted", "closed"),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("fix-submitted", "closed", {
        retestEvidenceComplete: true,
      }),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("fix-submitted", "closed", {
        regressionChecksPass: true,
      }),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("fix-submitted", "closed", {
        retestEvidenceComplete: true,
        regressionChecksPass: true,
      }),
    ).toBe(true);
  });

  it("supports waiver path and waiver disposition to close", () => {
    expect(
      canTransitionSecurityFindingState("confirmed", "waived"),
    ).toBe(true);
    expect(canTransitionSecurityFindingState("waived", "closed")).toBe(false);
    expect(
      canTransitionSecurityFindingState("waived", "closed", {
        waiverDispositionComplete: true,
      }),
    ).toBe(true);
  });

  it("supports triage dismissal closure with recorded rationale", () => {
    expect(canTransitionSecurityFindingState("triage", "closed")).toBe(false);
    expect(
      canTransitionSecurityFindingState("triage", "closed", {
        dismissalRecorded: true,
      }),
    ).toBe(true);
  });

  it("blocks elevated-severity triage dismissal closure without Reviewer attestation (VS-19)", () => {
    expect(
      canTransitionSecurityFindingState("triage", "closed", {
        dismissalRecorded: true,
        elevatedDismissalGate: true,
      }),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("triage", "closed", {
        dismissalRecorded: true,
        elevatedDismissalGate: true,
        elevatedDismissalReviewComplete: true,
      }),
    ).toBe(true);
  });

  it("supports reopen from closed only with evidence to triage, needs-review, or confirmed", () => {
    expect(
      canTransitionSecurityFindingState("closed", "fix-submitted", {
        reopenEvidenceAttached: true,
      }),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("closed", "confirmed", {
        reopenEvidenceAttached: true,
      }),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState("closed", "confirmed"),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("closed", "needs-review", {
        reopenEvidenceAttached: true,
      }),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState("closed", "triage", {
        reopenEvidenceAttached: true,
      }),
    ).toBe(true);
  });

  it("routes retest and regression failures back to fix-submitted", () => {
    expect(
      canTransitionSecurityFindingState(
        "fix-submitted",
        "retest-failed",
      ),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState(
        "retest-failed",
        "fix-submitted",
      ),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("retest-failed", "fix-submitted", {
        fixSubmissionEvidenceRecorded: true,
      }),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState(
        "fix-submitted",
        "regression-failed",
      ),
    ).toBe(true);
    expect(
      canTransitionSecurityFindingState(
        "regression-failed",
        "fix-submitted",
      ),
    ).toBe(false);
    expect(
      canTransitionSecurityFindingState("regression-failed", "fix-submitted", {
        fixSubmissionEvidenceRecorded: true,
      }),
    ).toBe(true);
  });

  it("throws on unsupported transitions", () => {
    expect(() =>
      assertTransitionSecurityFindingState("candidate", "closed"),
    ).toThrow();
  });

  it("parses known states", () => {
    expect(parseSecurityFindingState("waived")).toBe("waived");
    expect(parseSecurityFindingState("nope")).toBeNull();
  });
});
