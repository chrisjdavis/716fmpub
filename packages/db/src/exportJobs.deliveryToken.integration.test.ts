import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrationsToPglite } from "./test/applyMigrationsToPglite.js";
import { pgliteAsPool } from "./test/pglitePoolAdapter.js";
import {
  claimExpiredListenExportArtifacts,
  createExportJob,
  getExportJobByIdForUser,
  markExportJobCompleted,
  tryMarkExportJobRunning,
} from "./exportJobs.js";

const USER_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe.sequential("export_jobs delivery token (PGlite)", () => {
  let pglite: PGlite;

  beforeAll(async () => {
    pglite = new PGlite();
    await applyMigrationsToPglite(pglite);
  });

  afterAll(async () => {
    await pglite.close();
  });

  beforeEach(async () => {
    await pglite.exec(
      "TRUNCATE TABLE sessions, listens, import_jobs, export_jobs, users, tracks, albums, artists CASCADE",
    );
    await pglite.query(
      `insert into users (id, email, password_hash)
       values ($1::uuid, 'u@test', 'hash')`,
      [USER_ID],
    );
  });

  it("persists a delivery token on completion and clears it when the artifact is claimed expired", async () => {
    const pool = pgliteAsPool(pglite);
    const { id: exportJobId } = await createExportJob(pool, {
      userId: USER_ID,
      format: "json",
    });
    const claimed = await tryMarkExportJobRunning(pool, {
      exportJobId,
      userId: USER_ID,
    });
    expect(claimed?.stage).toBe("running");

    const token = "e".repeat(43);
    await markExportJobCompleted(pool, {
      exportJobId,
      userId: USER_ID,
      artifactRelativePath: `${USER_ID}/${exportJobId}.zip`,
      artifactRetentionSeconds: 3600,
      finalItemsProcessed: 0,
      artifactDeliveryToken: token,
    });

    const afterComplete = await getExportJobByIdForUser(pool, {
      exportJobId,
      userId: USER_ID,
    });
    expect(afterComplete?.artifactDeliveryToken).toBe(token);

    await pglite.query(
      `update export_jobs
       set artifact_expires_at = now() - interval '1 second'
       where id = $1::uuid`,
      [exportJobId],
    );

    const claimedRows = await claimExpiredListenExportArtifacts(pool, { limit: 10 });
    expect(claimedRows.some((r) => r.exportJobId === exportJobId)).toBe(true);

    const afterExpire = await getExportJobByIdForUser(pool, {
      exportJobId,
      userId: USER_ID,
    });
    expect(afterExpire?.stage).toBe("expired");
    expect(afterExpire?.artifactDeliveryToken).toBeNull();
    expect(afterExpire?.artifactRelativePath).toBeNull();
  });
});
