import pg from "pg";

import { loadServerEnv } from "@vs/env";
import { redactForLogLine } from "@vs/sensitive";

function formatUnknown(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactForLogLine(raw);
}

async function probeWithStandaloneClient(
  connectionString: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    await client.query("select 1 as ok");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: redactForLogLine(message) };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  let connectionString: string;
  try {
    connectionString = loadServerEnv().DATABASE_URL;
  } catch (err) {
    console.error(`Database configuration error: ${formatUnknown(err)}`);
    process.exit(1);
    return;
  }

  const result = await probeWithStandaloneClient(connectionString);
  if (!result.ok) {
    console.error(
      `Database connection failed: ${result.reason}. ` +
        "Check that PostgreSQL is running, DATABASE_URL matches your network and credentials, and migrations have been applied if required.",
    );
    process.exit(1);
    return;
  }

  console.error("Database connection OK.");
}

main().catch((err) => {
  console.error(`Database connection failed: ${formatUnknown(err)}`);
  process.exit(1);
});
