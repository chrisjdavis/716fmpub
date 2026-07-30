import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function createSqlOnlyPgm(migrationFile: string, chunks: string[]) {
  return new Proxy(
    {},
    {
      has(_target, prop) {
        return prop === "sql";
      },
      get(_target, prop) {
        if (prop === "sql") {
          return (s: string) => {
            chunks.push(s);
          };
        }
        if (typeof prop === "symbol") {
          return undefined;
        }
        throw new Error(
          `applyMigrationsToPglite: migration "${migrationFile}" used unsupported pgm.${String(prop)}; only pgm.sql() is supported for PGlite replay.`,
        );
      },
    },
  );
}

/**
 * Replays `exports.up` SQL from node-pg-migrate migrations.
 * Only `pgm.sql(...)` is supported; other `pgm.*` APIs throw so the harness cannot silently skip schema work.
 */
export async function applyMigrationsToPglite(pglite: PGlite): Promise<void> {
  const migrationsDir = join(__dirname, "../../migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".cjs"))
    .sort();
  for (const file of files) {
    const chunks: string[] = [];
    const fakePgm = createSqlOnlyPgm(file, chunks);
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- CJS migrations
    const mod = require(join(migrationsDir, file)) as {
      up: (pgm: { sql: (sql: string) => void }) => void;
    };
    mod.up(fakePgm as { sql: (sql: string) => void });
    await pglite.exec(chunks.join("\n\n"));
  }
}
