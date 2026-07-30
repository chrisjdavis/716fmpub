# Security testing scope boundaries (VS-1)

This document complements the Vector Sigma aggressive security pack: tooling and automation must **not** assume blanket authorization to probe every deployment. Scope, ceilings, and gates are enforced in code via `@vs/security-testing-scope`.

## Approved environments (priority order)

The canonical ordered list lives in `DEFAULT_SECURITY_TESTING_SCOPE.approvedEnvironmentPriority` and the JSON example under `packages/security-testing-scope/examples/default-scope.config.json`:

1. **local** — isolated developer machine or CI fixture; preferred for aggressive techniques.
2. **preview** — ephemeral branch or PR environment.
3. **staging** — dedicated QA / pre-production.
4. **production** — **never** treated as in-scope for automated aggressive testing unless `productionTestingExplicitlyApproved` is set **and** per-action approval gates are satisfied out-of-band (ticket / signed plan).

`effectiveApprovedEnvironments()` drops `production` from the candidate list until that explicit flag is true; individual actions still require `evaluateSecurityTestAction()`.

## Explicit out-of-scope actions (deny list)

These `SecurityTestActionKind` values are on the default **unconditional deny** list and cannot be cleared by approval gate ids alone (config would need to remove them deliberately in a forked contract, which should be code-reviewed):

- `third_party_or_out_of_repo_target` — no lateral testing outside approved repos/services.
- `data_exfiltration_attempt` — no exfiltration exercises against real user content.
- `destructive_state_mutation` — no corruption/deletion class attacks by default.
- `dos_or_resource_exhaustion` — no intentional availability attacks.
- `secrets_or_key_material_handling` — no handling of real secrets as test payloads.

Additional categories (for example `credential_stuffing_simulation`) are **approval-gated** rather than unconditionally denied so operators can run them with explicit PM/security signoff.

## Safety ceilings

Defaults in `DEFAULT_SECURITY_TESTING_SCOPE.safetyCeilings`:

| Ceiling | Default | Intent |
| --- | --- | --- |
| `globalMaxRequestsPerSecond` | 20 | Global request pressure cap for automated probes. |
| `perHostMaxRequestsPerSecond` | 5 | Per-host / per-origin throttle. |
| `maxConcurrentClientConnections` | 10 | Concurrency bound for clients (orchestrators should respect when opening sockets). |
| `dataHandling` | `synthetic_only` | Data tier: no live PII copies without elevating the enum and governance. |
| `stateMutation` | `reversible_ephemeral` | Mutations must be reversible or throwaway; destructive tier requires signed plan + config change. |
| `credentialPolicy` | `test_credentials_only` | No production user passwords or break-glass secrets as probe material. |

`evaluateSecurityTestAction` rejects intended RPS above these ceilings when `intendedGlobalRps` / `intendedPerHostRps` are supplied.

## Approval gates

Gates are identified by `gateId`. Automation records satisfied gates in `satisfiedApprovalGateIds` **only** after human approval is captured in your tracker (for example the built-in SQLite issue tracker). Satisfied gates **do not** override the unconditional deny list or production opt-in.

## Contract locations

- **TypeScript + Zod schema:** `packages/security-testing-scope/src/schema.ts`
- **Default policy object:** `packages/security-testing-scope/src/default-contract.ts`
- **Enforcement:** `packages/security-testing-scope/src/guard.ts`
- **JSON mirror:** `packages/security-testing-scope/examples/default-scope.config.json`

## Related operational docs

- `docs/security-architecture.md` — product trust boundaries and routes.
- Security pack `operational-rules.md` (pack workspace) — non-destructive defaults and environment ordering narrative.
