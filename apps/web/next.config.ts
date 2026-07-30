import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(__dirname, "..", "..");

const require = createRequire(import.meta.url);
let withBundleAnalyzer = (config: NextConfig): NextConfig => config;
try {
  type BundleAnalyzerPlugin = (opts: {
    enabled: boolean;
    openAnalyzer: boolean;
  }) => (config: NextConfig) => NextConfig;
  const mod = require("@next/bundle-analyzer") as {
    default?: BundleAnalyzerPlugin;
  };
  const bundleAnalyzer = (mod.default ?? mod) as BundleAnalyzerPlugin;
  withBundleAnalyzer = bundleAnalyzer({
    enabled: process.env.ANALYZE === "true",
    /**
     * Treemaps are written next to the web app build output: from `apps/web`, open
     * `.next/analyze/client.html` (from repo root: `apps/web/.next/analyze/client.html`).
     * Set `ANALYZE_OPEN=1` to open the browser automatically after `analyze:bundle`.
     */
    openAnalyzer: process.env.ANALYZE_OPEN === "1",
  });
} catch {
  /* Optional devDependency: `next build` must succeed in minimal installs without the analyzer. */
}

const nextConfig: NextConfig = {
  /** Pin tracing to this repo when other lockfiles exist higher in the tree. */
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: [
    "@vs/env",
    "@vs/domain",
    "@vs/db",
    "@vs/feature-flags",
    "@vs/queue",
    "@vs/sensitive",
  ],
  webpack(config) {
    /** `@vs/env` uses NodeNext `.js` specifiers on `.ts` sources; map for the bundler. */
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default withBundleAnalyzer(nextConfig);
