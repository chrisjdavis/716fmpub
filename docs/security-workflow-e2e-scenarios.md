# Security workflow — representative end-to-end scenarios (VS-21)

This document defines **representative scenarios** for the aggressive security remediation pack. **Execution evidence** is the passing Vitest suite in `packages/security-orchestrator/src/e2e/securityWorkflowRepresentativeScenarios.test.ts` (run via `npm test` from the repository root).

Operational rules, templates, and lifecycle vocabulary remain canonical in `docs/security-finding-lifecycle.md`, `docs/acceptance-validation.md` (pack copy), and `packages/security-orchestrator`.

## Gap list (failed scenarios)

When `securityWorkflowRepresentativeScenarios` fails in CI, record the Vitest output and the failing scenario id here during triage. **Current gap list:** _(none — all scenario tests passing on last green run.)_

---

## Scenario S1 — Confirmed finding through closure (with regression corpus growth)

**Intent:** Prove **comment → assign → remediate → adversarial retest → QA regression → closure** and that closure is **not** implied by a merged fix alone.

**Steps (logical):**

1. Intake: candidate signal is triaged to **confirmed** with auditable rationale.
2. Finding is in **ready-for-remediation** with Lead Engineer as next meaningful owner.
3. Lead Engineer records **fix submission** evidence (commits/PR pointers).
4. Reviewer records **adversarial retest** pass for the linked fix.
5. QA records **regression validation** pass linked to the same fix.
6. Orchestration applies **closure** only when retest + QA gates pass.
7. After closure, a **regression suite promotion** row is recorded (growing regression corpus).

**Pass condition:** Automated assertions in test case `S1 confirmed finding through closure`.

---

## Scenario S2 — False-positive triage (noise held out of engineering queue)

**Intent:** Prove scanner or ambiguous signal can be **dismissed from triage** with rationale and **without** entering the remediation queue.

**Steps (logical):**

1. Finding in **triage** with medium severity.
2. Triage disposition **false-positive** with dismissal rationale.
3. Workflow ends in **closed** with dismissal context; finding is classified as held out of engineering work.

**Pass condition:** Assertions in test case `S2 false-positive triage`.

---

## Scenario S3 — Incomplete fix → loop → eventual closure

**Intent:** Prove **fix is not validation**: first remediation attempt fails adversarial retest; a second fix cycle passes retest + QA and closes.

**Steps (logical):**

1. **ready-for-remediation** → **fix-submitted** (first fix).
2. Adversarial retest **fails** → **retest-failed** with reopen reason and workflow reopen history.
3. Second **fix-submitted** from **retest-failed** with new fix evidence.
4. Adversarial retest **pass** + QA **pass** → **closure**.

**Pass condition:** Assertions in test case `S3 reopen after incomplete fix then close`.

---

## Scenario S4 — Severity-based escalation (release + visibility)

**Intent:** Prove **Critical** findings drive **release blocking** and **PM + Lead Engineer** visibility in structured ticket automation.

**Steps (logical):**

1. Normalized **Critical** finding in **confirmed** (pre-remediation).
2. `deriveReleaseSecurityBlocking` reports a blocker; suggested tags include `security:release-blocked`.
3. Structured ticket comment body includes PM/Lead Engineer escalation line from assignment automation.

**Pass condition:** Assertions in test case `S4 severity-based escalation`.
