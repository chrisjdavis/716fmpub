# VS-57 — Layer 2+ consumption of Layer 1 evidence (retrieval, readiness, boundaries)

Engineering handoff for ranking, rendering, and LLM layers that sit **above** Layer 1. Layer 1 is the **only** approved place to turn listen history into durable, typed evidence objects. This note is the contract for how to read that store safely and what is intentionally undefined until later work ships.

## Hard rule: no invented claims

**Future layers must not bypass Layer 1** to assert user-specific listening facts, relationship semantics, or scores that are meant to read as “716FM computed this from your data.” If something is not present as a validated `Layer1EvidenceObject` row (or you are not explicitly in a UX mode that admits free-form speculation), you **must not** present it as grounded evidence.

- Allowed: paraphrase or visualize **fields** from parsed evidence; combine multiple Layer 1 rows **without** inventing new metrics; emit “unknown / not computed / stale” states.
- Forbidden: fabricating counts, windows, artist relationships, or narrative “insights” from model priors or raw `listens` ad hoc when the product contract calls for Layer 1–backed truth.

Violations break **backend-is-source-of-truth**, **no-fake-precision**, and **failure-visibility**: the user cannot tell what was measured versus imagined.

## Where Layer 1 lives (retrieval)

| Artifact | Role |
| --- | --- |
| `layer1_evidence_objects` | Durable evidence: one row per `signal_instance_id` (`UNIQUE`). `body_json` holds the full wire object; first-class columns mirror eligibility and comparability for SQL filters. |
| `layer1_signal_runs` | Job provenance: `status`, `error_code`, timestamps. Use to see whether a batch recompute succeeded; do not treat a succeeded run alone as proof every user row is eligible. |
| `listens` / rollups | **Canonical sources** for freshness checks when implementing read-time staleness probes (see `layer1SignalPersistence.ts` module comment on replace-upsert semantics). |

Typical read paths:

1. **By user + signal:** `WHERE user_id = $1 AND signal_kind = $2` (see index `layer1_evidence_objects_user_signal_created_idx`). Idempotent writers key on stable `signal_instance_id` (`ON CONFLICT DO UPDATE` in `upsertLayer1EvidenceObject` does **not** bump `created_at`), so do **not** use `created_at` as recompute freshness; after parse, use `emittedAtMs` / `sourceObservedThroughMs` from the wire object (or add an explicit `updated_at` column in a future migration if SQL-side ordering is required).
2. **By window / artist:** use `scope_kind`, `window_start_ms` / `window_end_ms`, and `artist_mbid` / `artist_url_key` as appropriate (see migration `1744560000038_layer1-signal-evidence-and-runs.cjs`).
3. **Eligibility without parsing JSON:** prefer `eligible_for_downstream_use`, `insufficiency_codes`, `insufficiency_evaluation_as_of_ms`, and comparability flags on the row (migration `1744560000039_layer1-evidence-eligibility-metadata.cjs`).

## Wire contract (parse, do not guess)

After loading `body_json`:

- Validate with `parseLayer1EvidenceObject` from `@vs/domain` (`packages/domain/src/evidence/layer1EvidenceObject.ts`). Handle `{ ok: false }` explicitly: treat as **invalid / do not use for product claims**.
- Respect `schemaVersion`, `signalKind`, `signalDefinitionVersion`, and `scope` as part of the identity of the row; do not coerce unknown versions into current shapes.
- **Staleness and precision:** use `sourceObservedThroughMs` vs wall time (and any product-specific thresholds) before high-confidence copy. If `eligible_for_downstream_use` is false, surface **insufficiency** (machine codes in `insufficiency.codes` and mirrored `insufficiency_codes` on the row)—do not round up to “strong” language.
- **Comparability:** read `comparability` (and DB mirror columns). Do not rank or compare across users or windows when the flags say those comparisons are unsupported.

## Supported signal families (today)

The codebase currently materializes **listen-derived, user–artist relationship evidence** under:

| Field | Value |
| --- | --- |
| `signalKind` | `artist.user_relationship.v1` (`ARTIST_USER_RELATIONSHIP_SIGNAL_KIND` in `packages/domain/src/artistUserRelationshipSignals.ts`) |
| Metric family | `716fm.artist.user_relationship.v1` |
| Definition version | `1` (`ARTIST_USER_RELATIONSHIP_SIGNAL_DEFINITION_VERSION`) |

Other `signal_kind` values may appear as the pipeline grows; treat unknown kinds as **opaque** until a ticket documents their payload and comparability rules.

## How evidence is produced (so readers know freshness limits)

- **Offline recompute:** BullMQ job `layer1_evidence_recompute` (`packages/queue/src/job-contracts.ts`), enqueue orchestration in `packages/db/src/layer1EvidenceRecomputeEnqueue.ts`, worker orchestration in `packages/db/src/layer1EvidenceRecomputeJob.ts`.
- **Dashboard bundle path:** `recomputeDashboardAnalyticsBundle` (`packages/db/src/dashboardAnalyticsRecompute.ts`) **does not** write Layer 1. Product code enqueues `layer1_evidence_recompute` separately (e.g. after `windowed_aggregate` completes, or on import / listen hooks) — see [VS-92](./VS-92-task-9-1-layer1-automation-lifecycle.md).
- **Processing caps:** rolling window, top-N artists per user, and per–user+artist play-row caps are **implementation contracts**—see `docs/performance/vs-56-layer1-performance-and-failure-modes.md`. Readers must understand evidence may be **absent** for an artist that exceeded caps or failed extraction, not “zero relationship.”

## Known gaps (intentional until Layer 2+ ships)

- **No ranking layer** in-repo: no canonical ordering of multiple signals for feed or “most important” beyond what Layer 1 scores and insufficiency already express.
- **No rendering / copy templates** tied to insufficiency codes: product strings for `STALE_SOURCE`, `INSUFFICIENT_SAMPLE`, etc. are not centralized here.
- **No append-only history** of evidence bodies in Postgres: current row is authoritative; point-in-time audit is a non-goal unless a future ticket adds an audit store (`layer1SignalPersistence.ts`).
- **No automatic cross-signal fusion rules:** combining `artist.user_relationship.v1` with other kinds requires explicit downstream design and tests.

## Related docs

- `docs/implementation-notes/VS-92-task-9-1-layer1-automation-lifecycle.md` — triggers, entitlement, manual paths, signal version / watermark.
- `docs/implementation-notes/VS-41-ai-layer-1-integration-boundaries.md` — where Layer 1 fits in the broader ingest/analytics stack.
- `docs/performance/vs-56-layer1-performance-and-failure-modes.md` — batch limits, failure modes, recovery.
- Domain modules: `packages/domain/src/evidence/layer1EvidenceObject.ts`, `layer1EvidencePersistenceMetadata.ts`, `layer1SignalPersistence.ts`.
