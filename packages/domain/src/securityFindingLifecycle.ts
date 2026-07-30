/**
 * Deterministic lifecycle for security findings (Vector Sigma / VS-2).
 * Human-readable rules and diagrams: docs/security-finding-lifecycle.md
 */

export const SECURITY_FINDING_STATES = [
  "candidate",
  "triage",
  "confirmed",
  "needs-review",
  "ready-for-remediation",
  "fix-submitted",
  "retest-failed",
  "regression-failed",
  "waived",
  "closed",
] as const;

export type SecurityFindingState = (typeof SECURITY_FINDING_STATES)[number];

export type SecurityFindingCloseContext = {
  /** Adversarial retest of original + agreed variant set recorded complete. */
  retestEvidenceComplete: boolean;
  /** Deterministic regression / product checks recorded pass. */
  regressionChecksPass: boolean;
};

export type SecurityFindingDismissalContext = {
  /** Duplicate, false positive, or informational non-defect with audit rationale. */
  dismissalRecorded: boolean;
  /**
   * When true, dismissal is for Critical/High severity and must not close without
   * explicit Reviewer attestation (VS-19 severity gate).
   */
  elevatedDismissalGate?: boolean;
  /** Reviewer-recorded dismissal validation for elevated-severity triage closures. */
  elevatedDismissalReviewComplete?: boolean;
};

export type SecurityFindingWaiverCloseContext = {
  /** Rationale, owner, expiration/follow-up captured per waiver policy. */
  waiverDispositionComplete: boolean;
};

export type SecurityFindingReopenContext = {
  /** Reproduction, bypass, sibling path, regression break, or evidence gap documented. */
  reopenEvidenceAttached: boolean;
};

/** Recorded fix submission notes (commits/PRs, summary, migrations) attached before entering `fix-submitted`. */
export type SecurityFindingFixSubmissionContext = {
  fixSubmissionEvidenceRecorded: boolean;
};

export type SecurityFindingTransitionContext = Partial<
  SecurityFindingCloseContext &
    SecurityFindingDismissalContext &
    SecurityFindingWaiverCloseContext &
    SecurityFindingReopenContext &
    SecurityFindingFixSubmissionContext
>;

const TERMINAL: ReadonlySet<SecurityFindingState> = new Set(["closed"]);

const REOPEN_TARGETS: ReadonlySet<SecurityFindingState> = new Set([
  "triage",
  "needs-review",
  "confirmed",
]);

/** Structural transitions that do not use closure/reopen guard parameters. */
const ALLOWED: ReadonlyMap<
  SecurityFindingState,
  ReadonlySet<SecurityFindingState>
> = new Map([
  ["candidate", new Set(["triage", "needs-review"])],
  [
    "triage",
    new Set(["candidate", "needs-review", "confirmed", "waived"]),
  ],
  [
    "needs-review",
    new Set(["candidate", "triage", "confirmed"]),
  ],
  [
    "confirmed",
    new Set(["needs-review", "ready-for-remediation", "waived"]),
  ],
  [
    "ready-for-remediation",
    new Set(["needs-review", "fix-submitted", "waived"]),
  ],
  [
    "fix-submitted",
    new Set([
      "needs-review",
      "retest-failed",
      "regression-failed",
      "ready-for-remediation",
    ]),
  ],
  [
    "retest-failed",
    new Set(["fix-submitted", "needs-review"]),
  ],
  [
    "regression-failed",
    new Set(["fix-submitted", "needs-review"]),
  ],
  ["waived", new Set(["ready-for-remediation"])],
  ["closed", new Set()],
]);

export function isTerminalSecurityFindingState(
  state: SecurityFindingState,
): boolean {
  return TERMINAL.has(state);
}

const FIX_SUBMISSION_ENTRY_STATES: ReadonlySet<SecurityFindingState> = new Set([
  "ready-for-remediation",
  "retest-failed",
  "regression-failed",
]);

function canEnterFixSubmittedState(
  from: SecurityFindingState,
  ctx: SecurityFindingTransitionContext | undefined,
): boolean {
  if (!FIX_SUBMISSION_ENTRY_STATES.has(from)) {
    return false;
  }
  return ctx?.fixSubmissionEvidenceRecorded === true;
}

function canCloseSecurityFinding(
  from: SecurityFindingState,
  ctx: SecurityFindingTransitionContext | undefined,
): boolean {
  if (!ctx) {
    return false;
  }
  if (from === "fix-submitted") {
    return (
      ctx.retestEvidenceComplete === true && ctx.regressionChecksPass === true
    );
  }
  if (from === "waived") {
    return ctx.waiverDispositionComplete === true;
  }
  if (from === "triage") {
    if (!ctx.dismissalRecorded) {
      return false;
    }
    if (ctx.elevatedDismissalGate) {
      return ctx.elevatedDismissalReviewComplete === true;
    }
    return true;
  }
  return false;
}

function canReopenSecurityFinding(
  to: SecurityFindingState,
  ctx: SecurityFindingTransitionContext | undefined,
): boolean {
  if (!ctx?.reopenEvidenceAttached) {
    return false;
  }
  return REOPEN_TARGETS.has(to);
}

/**
 * Whether `from` may advance to `to` in one step. Identity transitions are allowed.
 * Closure and reopen edges require explicit context (see docs).
 */
export function canTransitionSecurityFindingState(
  from: SecurityFindingState,
  to: SecurityFindingState,
  ctx?: SecurityFindingTransitionContext,
): boolean {
  if (from === to) {
    return true;
  }
  if (to === "closed") {
    return canCloseSecurityFinding(from, ctx);
  }
  if (from === "closed") {
    return canReopenSecurityFinding(to, ctx);
  }
  if (to === "fix-submitted" && !canEnterFixSubmittedState(from, ctx)) {
    return false;
  }
  const next = ALLOWED.get(from);
  return next?.has(to) ?? false;
}

export function assertTransitionSecurityFindingState(
  from: SecurityFindingState,
  to: SecurityFindingState,
  ctx?: SecurityFindingTransitionContext,
): void {
  if (!canTransitionSecurityFindingState(from, to, ctx)) {
    throw new Error(
      `Unsupported security finding transition: ${from} -> ${to}`,
    );
  }
}

export function parseSecurityFindingState(
  value: string,
): SecurityFindingState | null {
  return (SECURITY_FINDING_STATES as readonly string[]).includes(value)
    ? (value as SecurityFindingState)
    : null;
}
