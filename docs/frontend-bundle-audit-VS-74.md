# Frontend bundle audit — VS-74 (TASK 4.1)

## How we measure

- **Production build:** `npm run build -w web` (Next.js 15 prints per-route JS and “First Load JS”).
- **Webpack treemap (optional):** `npm run analyze:bundle -w web` sets `ANALYZE=true`, then open `apps/web/.next/analyze/client.html` (and `nodejs.html`, `edge.html`) after the build. Browser opens only if `ANALYZE_OPEN=1` is set.
- **On-disk chunks:** `apps/web/.next/static/chunks/**` (hashed filenames change when sources change).

### Verification limits

- **`dashboard-panels.bundle-contract.test.ts`** only asserts that `dashboard-panels.tsx` keeps a **dynamic** `import("./dashboard-import-panels")` and avoids a static `from "./dashboard-import-panels"` line. It does **not** read webpack stats or prove a chunk is absent; use `next build`, `npm run analyze:bundle -w web`, and `.next/static/chunks/**` for that.

## Route-level summary (representative `next build` output)

| Route | Route JS | First Load JS | Notes |
|-------|-----------|---------------|--------|
| `/` | ~3.2 kB | ~109 kB | Marketing shell |
| `/dashboard` | ~2.7 kB (after split) / ~2.2 kB (before) | ~124 kB | Heaviest authenticated “hub” |
| `/dashboard/imports` | ~0.2 kB | ~122 kB | Thin page file; work lives in shared + RSC |
| `/dashboard/archive` | ~5 kB | ~110 kB | Larger route module |
| `/dashboard/settings` | ~3.5 kB | ~109 kB | |
| `/dashboard/export` | ~1.7 kB | ~107 kB | |
| Auth pages (`/login`, `/signup`, …) | ~1–1.6 kB | ~106–107 kB | |
| **Shared by all** | — | **~102 kB** | React runtime + `main-app` graph |

**Middleware:** ~49.6 kB (separate from route “First Load JS” line item, still cold-start cost at the edge).

## Large / notable dependencies (client-relevant)

- **Next + React framework chunks** dominate shared “First Load JS” (~102 kB baseline in this app). Replacing the framework is out of scope; wins are mostly **splitting**, **deferring**, and **not pulling optional UI into the critical graph**.
- **`next/font/google` (root layout):** three families (`Doto`, `Space_Grotesk`, `Space_Mono`). Font CSS is streamed; still a deliberate weight vs system fonts.
- **Workspace packages** (`@vs/env`, `@vs/db`, …) are mostly server/RSC; they inflate **Node** bundles (see `nodejs.html` in analyzer), not necessarily the browser treemap.
- **`hash-wasm` / `archiver`:** used on the **server** (for example password hashing / archives), not a client-bundle driver in this tree.

## Duplication and “heavy up front” patterns

- **Treemap evidence:** for duplicate *module* parents or surprise shared edges, inspect `apps/web/.next/analyze/client.html` after `analyze:bundle`; the bullets below are structural inference from route metrics, not a substitute for that pass.
- **`/dashboard` vs `/dashboard/imports`:** similar “First Load JS” (~124 kB vs ~122 kB) despite a tiny imports route module — shared layout + shared client/runtime dominate.
- **Import job UI on the main dashboard:** historically, `dashboard-import-panels` was **statically** imported from `dashboard-panels`, so its module graph was always a dependency of the `/dashboard` page chunk even when `body.kind === "completed"` (no import UI rendered). That is unnecessary coupling for the completed-data path.

## Implemented fix (with before / after)

**Change:** `DashboardImportJobPanels` is loaded with `next/dynamic` + `import()` only on `empty` / `in_progress` / `failed` branches in `dashboard-panels.tsx`, with an explicit **`loading`** UI so the async chunk never presents a silent empty region. The `/dashboard/imports` page still **statically** imports the same module (appropriate for that route).

| Metric | Before (static import) | After (dynamic `import()`) |
|--------|-------------------------|----------------------------|
| `next build` “First Load JS” for `/dashboard` | ~124 kB | ~124 kB (unchanged aggregate) |
| On-disk `app/dashboard/page-*.js` (one build) | 5,364 bytes | 7,095 bytes (+loader / manifest overhead) |
| `dashboard-import-panels` in static graph for completed dashboard | Yes | No (async boundary) |

**Interpretation:** Next’s rolled-up “First Load JS” does not drop here, but the **module graph** for users on the completed dashboard no longer statically includes import-job panels code. Further gains need additional splits (for example isolating heavy client islands) or shared-chunk work.

## Remediation backlog (prioritized)

1. **Treemap-driven passes:** run `analyze:bundle` after major dependency bumps; inspect `client.html` for unexpected shared parents.
2. **Dashboard layout client islands:** `ClientPerfTelemetry` and `DashboardListenFingerprintPoller` are always mounted under `/dashboard/**`; consider lazy client mounts if we accept slightly later instrumentation (product decision).
3. **`dashboard-cover-thumb`:** ESLint flags raw `<img>`; migrating to `next/image` or a dedicated loader can reduce wasted bytes and bandwidth on LCP paths (not strictly bundle size, related to perceived load).
4. **Middleware (~50 kB):** audit imports in `middleware.ts`; ensure no server-only or heavy deps leak into the edge bundle.
5. **Optional package import optimization:** if we add icon/date libraries later, use `experimental.optimizePackageImports` (Next) to avoid barrel-file blowups.
6. **Replace speculative client inference with server contracts** (product constraint): keep computed analytics on the server so the client does not grow “shadow logic” libraries.

## Commands (copy/paste)

```bash
npm run build -w web
npm run analyze:bundle -w web
# Optional: open treemap in a browser automatically
ANALYZE_OPEN=1 npm run analyze:bundle -w web
```
