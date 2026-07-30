# VS-62 — Advanced-gated “listening insights” read contract

Product language in the app uses **Advanced** (`users.product_plan` via session, `requireAdvancedEntitlement` / `hasAdvancedEntitlement` in `@vs/domain`). Staff `account_role` is **not** a substitute.

## What “gated reads” means in this repo (VS-62)

These surfaces combine **rule-built narrative**, **time-machine editorial copy**, and/or **dashboard bundle** aggregates that ship on the same worker path as Layer-1 evidence refresh. For entitlement and reviewer clarity we treat them as a single **“listening insights”** product bucket (not only rows in `layer1_evidence_objects`):

| Surface | Enforcement |
| --- | --- |
| `GET /api/analytics/summary` | **Advanced only** — full `DashboardListenSummary` + snapshot metadata; Core → `403` + `code: advanced_entitlement_required`. |
| `GET /api/analytics/window-total` | **All plans** — `total_scrobbles` only, **canonical `listens` SQL** via `readCachedCanonicalDashboardListenSummary`; does **not** read `dashboard_bundle_v1`. |
| Home briefing loader (`loadDashboardHomeBriefingForCompletedHome`) | When Core: returns gate shell only; **no** `home_briefing_v1` snapshot read and **no** rollup SQL for narrative. |
| Musical Time Machine loader (`loadTimeMachineExploreModel`) | When Core: returns before any explore SQL; RSC shows gate UI. |
| Archive highlight refresh (client) | Core: uses `window-total` for tape counts; **does not** call `summary` for highlights; UI shows an explicit notice. |

Durable Layer-1 evidence storage and jobs remain documented in [VS-41](./VS-41-ai-layer-1-integration-boundaries.md) and [Layer 1 one-pager](../layer1-developer-one-pager.md).

## Why `summary` is Advanced-gated

`GET /api/analytics/summary` returns top artists/tracks/albums and prefers `analytics_snapshots` `dashboard_bundle_v1` — the same recompute family that refreshes bounded `layer1_evidence_objects` in the worker. Exposing that bundle JSON to Core would violate the VS-62 “no AI-derived analysis reads” bar for that API contract.

## Why `window-total` is not Advanced-gated

Archive tape UI needs a **deterministic play count** for the selected window. That count is served from **canonical listens aggregations only**, with **no** read of `dashboard_bundle_v1`, so Core never observes snapshot materialization for that endpoint.

## Local smoke / seed

`scripts/seed-local-test-account.ts` leaves **`product_plan` at DB default (`core`)** unless operators set it otherwise. `scripts/smoke-local.ts` exercises **`window-total`** for post-login analytics smoke and treats **`summary` `403`** with `advanced_entitlement_required` as success for Core.
