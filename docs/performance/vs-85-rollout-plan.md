# VS-85 — Performance rollout and real-user validation plan (TASK 8.2)

This plan ships performance work in **rollout-ready batches**, stages **high-risk** changes deliberately, defines **100-user** validation without fake precision, and ties outcomes to **before/after metrics** so we can see which changes moved real experience.

**Principles (non-negotiable):** backend remains source of truth for derived UX state; stale or missing telemetry is **labeled**, not smoothed over; contracts for APIs and logs stay explicit (see [`docs/performance-audit-baseline.md`](../performance-audit-baseline.md), [`docs/analytics/read-models.md`](../analytics/read-models.md), [`docs/performance/vs-77-caching-plan.md`](./vs-77-caching-plan.md)).

---

## 1. Rollout-ready batches

Group merges so each batch is **deployable as a unit**, has a **single rollback story** (revert deploy or flip a documented flag), and maps to **one primary measurement slice** in §4 (before / after comparison).

| Batch | Theme | Typical contents (examples from repo history / docs) | Primary win signal |
|-------|--------|--------------------------------------------------------|--------------------|
| **A — Measurement and CI gates** | Baseline JSON, `perf:check:budgets`, PGlite query envelopes, honest `null` + `reason` in benchmark contracts | VS-64-style baselines, VS-84 budgets ([`docs/performance-audit-baseline.md`](../performance-audit-baseline.md)) | CI green; no regression on recorded envelopes |
| **B — Navigation and request elimination** | Fewer redundant client fetches, RSC carrying default archive page, prefetch on shell | VS-81 route transitions ([`docs/performance/vs-81-route-transitions.md`](./vs-81-route-transitions.md)) | Drop in duplicate `archive-listens` calls on default archive load; stable HTML/API timings |
| **C — Client refresh discipline** | Coalesced `router.refresh`, path-gated invalidation, optional client perf telemetry | VS-73, VS-75 ([`docs/performance-baseline/vs-75-build-first-load-verify.json`](../performance-baseline/vs-75-build-first-load-verify.json)) | Fewer full-tree refreshes on irrelevant routes; Web Vitals stable when `NEXT_PUBLIC_VS_CLIENT_PERF=1` |
| **D — Read caching and analytics snapshots** | TTL read cache, snapshot reads, enqueue-on-stale | VS-77 plan, VS-78 telemetry semantics | `snapshot_read` / `fingerprint_read_model` rates; server loader ms; **no** increase in silent staleness reports |
| **E — Data-layer and transport hardening** | Query shape, websocket control plane, session cost on hot polls | [`vs-66-api-route-audit.md`](./vs-66-api-route-audit.md), [`vs-68-db-query-plan-audit.md`](./vs-68-db-query-plan-audit.md), [`vs-71-websocket-audit.md`](./vs-71-websocket-audit.md) | Per-route `msTotal`, DB loader aggregates, WS auth→ready ms where harness exists |

**Rule:** Do not mix **E** database or session semantics with **D** caching in the same deploy unless the combined diff was integration-tested together; both touch correctness paths.

---

## 2. High-risk changes — identification and staging

| Risk tier | Signals | Staging |
|-----------|---------|---------|
| **P0 — Correctness / tenancy** | New cache layers, snapshot invalidation rules, SQL that changes row visibility or ordering | **Last** in a release train, or behind a **server-side flag** with instant disable path; require extended soak in 100-user env |
| **P1 — Realtime and polling** | WebSocket auth, fingerprint poller, coalescing windows | Ship after A+B validated; monitor reconnect storms and `listen-fingerprint` QPS |
| **P2 — Client-only navigation** | Prefetch, RSC payload shape, duplicate fetch removal | Can follow B soon after CI gates; rollback is deploy-only |
| **P3 — Observability-only** | New marks, log fields, budget JSON | First in train; no user-visible behavior |

**High-risk checklist before promote:** queue depth healthy for `windowed_aggregate`, no spike in `http_5xx` on `/api/analytics/summary`, fingerprint API error rate flat, operator dashboard shows explicit stale reasons when probes fail (not blank dashboards).

---

## 3. Real-user validation — 100-user test environment

**Population:** exactly **100** active tester accounts (or capped concurrent sessions if there are fewer than 100 accounts) with **mixed library sizes** and **imports enabled**, so snapshot hit/miss and archive paths are exercised.

**Minimum soak duration:** **5 business days** per batch after deploy, unless a P0 forces rollback earlier.

**Pass / fail criteria (all must be explicit in dashboards or logs):**

1. **No regression on availability:** error rate on `GET /dashboard`, `GET /dashboard/archive`, `GET /api/analytics/summary`, `GET /api/me/listen-fingerprint` does not exceed **pre-batch baseline + agreed margin** (document the margin in the deploy ticket).
2. **Latency — distribution, not vanity mean:** compare **p50 / p75 / p95** server time (or CDN origin time) for the same routes as in [`docs/performance-audit-baseline.md`](../performance-audit-baseline.md); if client RUM is used, compare **LCP / INP** only when `NEXT_PUBLIC_VS_CLIENT_PERF=1` (or equivalent) is **on for the cohort** and sample size ≥ **500** qualified sessions **per variant** (sessions may accumulate across the 100-user cohort over the soak window—users are not required to each contribute five sessions); otherwise state **“RUM not comparable”** instead of inferring.
3. **Honest freshness:** rate of responses with explicit `snapshot_read` / `canonical_listens` (or documented equivalents) unchanged or improved vs baseline; **never** treat missing telemetry as “zero delay.”
4. **Queue and worker health:** BullMQ analytics job **age p95** does not exceed pre-deploy baseline by more than agreed threshold; if threshold exceeded, **fail** validation and roll forward only after queue fix.
5. **Subjective tester channel:** structured survey (1–5) on “archive loads,” “stats refresh,” “imports screen” with **≥ 40% response rate** or note **insufficient sample** in the report.

**Failure visibility:** any criterion not measurable must be reported as **blocked**, with owner and date to wire the metric—not as passed.

---

## 4. Before / after metrics comparison

| Phase | When | Actions |
|-------|------|---------|
| **T−24h** | Before deploy window | Capture **git SHA**, **deploy tag**, DB migration version, Redis/BullMQ version; run [`docs/performance-audit-baseline.md`](../performance-audit-baseline.md) **How to reproduce** steps 3–6 on the **100-user stack** (not only laptop dev); store JSON under `docs/performance-baseline/` with filename including env + date |
| **T0** | Deploy single batch | Record deploy timestamp and feature flag matrix |
| **T+24h / T+72h / T+5d** | Post-deploy | Re-run the same harness commands; for production-like `next start`, follow the baseline doc’s HTTPS / Playwright caveats—do not compare incompatible harnesses |
| **Compare** | Release review | Side-by-side table: route → metric → before → after → delta; flag **harness changes** that invalidate comparison |

**CI vs real users:** CI proves **non-regression on bounded fixtures**; the 100-user env proves **interaction and scale**. Both rows must appear in the release note.

---

## 5. Attributing speed improvements to specific changes

Sequential batches (§1) are the default: **the batch at deploy N** owns the delta observed until N+1 ships.

**Finer attribution (when needed):**

- **One PR / one issue per behavioral change** in performance work; release notes list issue IDs next to metrics moved.
- **Feature flags:** when used, log flag variant on **server** traces (`x-vs-trace` family per VS-65) so logs can be grouped by variant.
- **Micro-benches:** for DB-only wins, re-run documented scripts (e.g. `npm run bench:vs82 -w @vs/db`, `bench:vs70`) and attach JSON to the PR; label as **micro-bench**, not end-user proof.
- **A/B:** only when infra supports consistent bucketing **and** sample sizes meet §3; otherwise do not claim experiment-grade attribution.

---

## 6. Roles and gates

| Gate | Owner | Artifact |
|------|-------|----------|
| Batch scoped | PM | Issue lists batch id (A–E) + non-goals |
| Technical risk | Lead dev | PR links + rollback note |
| Pre-merge quality | CI | `npm test`, `perf:check:budgets` per repo workflow |
| Post-merge validation | QA / on-call | Checklist from §3 filled with numbers or explicit “not measured” |

---

## 7. References

- Baseline and reproduction: [`docs/performance-audit-baseline.md`](../performance-audit-baseline.md)
- Caching contracts: [`docs/performance/vs-77-caching-plan.md`](./vs-77-caching-plan.md), [`docs/analytics/read-models.md`](../analytics/read-models.md)
- Route transition example: [`docs/performance/vs-81-route-transitions.md`](./vs-81-route-transitions.md)
- Duplication / bench honesty: [`docs/performance/vs-82-duplication-audit-inventory.md`](./vs-82-duplication-audit-inventory.md)
