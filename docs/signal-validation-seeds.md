# VS-54 — Signal validation listening seeds

716FM AI Layer 1 validation needs **non-uniform**, **realistic** listening histories: streaks, bursts, dormant returns, sparse coverage, and exploration-heavy profiles. This workspace ships deterministic **Last.fm-shaped import rows** that flow through the same `raw_scrobbles` → canonical `listens` path as production imports.

## Profiles

| Profile id | Intent |
| --- | --- |
| `rich_long_term` | Multi-hundred-day tail, ~14-day local listening streak (`America/New_York`), a six-play burst (≤90s gaps), and a core artist returning after a long quiet period. |
| `sparse_partial_importer` | Few plays spread across many calendar days — sparse coverage and low sample depth. |
| `exploratory_listener` | ~48 plays in a short tail with many distinct tracks and 16 artists — high exploration ratio. |

Stable expectations text lives in `SIGNAL_VALIDATION_PROFILE_EXPECTATIONS` in `@vs/db/test/signalValidationListenSeeds`.

## Fixture clock

`SIGNAL_VALIDATION_FIXTURE_NOW_MS` is **2026-04-23T17:00:00.000Z**. Rolling-window assertions in tests should anchor to this value (or pass an explicit `nowMs` into `buildSignalValidationRawImportRows`).

## Programmatic use (automated tests)

Import from the package subpath:

```ts
import {
  SIGNAL_VALIDATION_FIXTURE_NOW_MS,
  buildSignalValidationRawImportRows,
  batchInsertRawImportListenRowsThenCanonicalize,
  signalValidationSeedUserId,
  signalValidationSeedImportJobId,
} from "@vs/db/test/signalValidationListenSeeds";
```

1. Insert a `users` row (set `stats_timezone` to `America/New_York` to match the fixture contract).
2. Insert an `import_jobs` row for that user.
3. Call `batchInsertRawImportListenRowsThenCanonicalize` with the profile id.

Reference integration tests: `packages/db/src/signalValidationListenSeeds.integration.test.ts`.

## Local / dev database seeding

From the repository root (requires `DATABASE_URL` and non-production `DEPLOY_ENV` / deploy environment):

```bash
npm run seed:signal-validation -w @vs/db
```

Creates three users:

- Emails: `vs54+<profile_id>@seed.716fm.test`
- IDs: `signalValidationSeedUserId(profile)` (deterministic UUIDs)

Re-running the script **deletes** each seed user by id first, then re-imports (idempotent for local iteration).

The placeholder password hash is **not** a login secret; use only in disposable databases.
