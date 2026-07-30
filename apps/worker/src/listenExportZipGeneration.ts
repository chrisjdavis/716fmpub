import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { finished } from "node:stream/promises";
import {
  getArchiveListensPage,
  resetExportJobListenProgress,
  updateExportJobListenProgress,
  type ListenExportFormat,
} from "@vs/db";
import type { Pool } from "pg";

const EXPORT_BATCH_LIMIT = 2000;

function exportZipFilename(utcYmd: string, format: ListenExportFormat): string {
  return `716fm-listens-${utcYmd}-${format}.zip`;
}

function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function csvLineFromListen(row: {
  played_at: string;
  listen_id: string;
  track_id: string;
  track_title: string;
  artist_name: string;
  album_id: string | null;
  album_title: string | null;
  musicbrainz_release_mbid: string | null;
  lastfm_cover_image_url: string | null;
  listen_source: string;
}): string {
  const cells = [
    row.played_at,
    row.listen_id,
    row.track_id,
    row.track_title,
    row.artist_name,
    row.album_id ?? "",
    row.album_title ?? "",
    row.musicbrainz_release_mbid ?? "",
    row.lastfm_cover_image_url ?? "",
    row.listen_source,
  ];
  return `${cells.map(csvEscapeCell).join(",")}\n`;
}

async function writeWhenDrainable(writable: PassThrough, chunk: string | Buffer): Promise<void> {
  const ok = writable.write(chunk);
  if (ok) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    writable.once("drain", resolve);
    writable.once("error", reject);
  });
}

async function pipeListensCsvTo(
  dest: PassThrough,
  pool: Pool,
  userId: string,
  onListenBatch: (batchLen: number) => Promise<void>,
): Promise<void> {
  const header =
    "played_at,listen_id,track_id,track_title,artist_name,album_id,album_title,musicbrainz_release_mbid,lastfm_cover_image_url,listen_source\n";
  await writeWhenDrainable(dest, header);
  let cursor: { played_at: string; listen_id: string } | null = null;
  for (;;) {
    const batch = await getArchiveListensPage(pool, {
      userId,
      range: "all",
      limit: EXPORT_BATCH_LIMIT,
      limitMode: "export",
      cursor,
      q: null,
      source: "all",
      type: "tracks",
    });
    for (const row of batch) {
      await writeWhenDrainable(dest, csvLineFromListen(row));
    }
    if (batch.length > 0) {
      await onListenBatch(batch.length);
    }
    if (batch.length < EXPORT_BATCH_LIMIT) {
      break;
    }
    const last = batch[batch.length - 1];
    if (!last) {
      break;
    }
    cursor = { played_at: last.played_at, listen_id: last.listen_id };
  }
}

async function pipeListensJsonTo(
  dest: PassThrough,
  pool: Pool,
  userId: string,
  exportedAt: string,
  onListenBatch: (batchLen: number) => Promise<void>,
): Promise<void> {
  await writeWhenDrainable(
    dest,
    `{"export_version":1,"exported_at":${JSON.stringify(exportedAt)},"user":${JSON.stringify({
      id: userId,
    })},"listens":[`,
  );
  let first = true;
  let cursor: { played_at: string; listen_id: string } | null = null;
  for (;;) {
    const batch = await getArchiveListensPage(pool, {
      userId,
      range: "all",
      limit: EXPORT_BATCH_LIMIT,
      limitMode: "export",
      cursor,
      q: null,
      source: "all",
      type: "tracks",
    });
    for (const row of batch) {
      const piece = first ? JSON.stringify(row) : `,${JSON.stringify(row)}`;
      await writeWhenDrainable(dest, piece);
      first = false;
    }
    if (batch.length > 0) {
      await onListenBatch(batch.length);
    }
    if (batch.length < EXPORT_BATCH_LIMIT) {
      break;
    }
    const last = batch[batch.length - 1];
    if (!last) {
      break;
    }
    cursor = { played_at: last.played_at, listen_id: last.listen_id };
  }
  await writeWhenDrainable(dest, "]}");
}

export { exportZipFilename };

export type GenerateListenExportZipFileInput = Readonly<{
  pool: Pool;
  userId: string;
  exportJobId: string;
  format: ListenExportFormat;
  artifactsBaseDir: string;
  /**
   * When set, resets and updates `export_jobs.items_processed` while streaming (Postgres source of truth).
   */
  exportJobProgress?: Readonly<{ exportJobId: string; userId: string }>;
}>;

export type GenerateListenExportZipFileResult = Readonly<{
  artifactRelativePath: string;
  displayZipName: string;
  itemsProcessed: number;
}>;

/**
 * Writes a completed listen export ZIP under `artifactsBaseDir/<userId>/<exportJobId>.zip`.
 */
export async function generateListenExportZipFile(
  input: GenerateListenExportZipFileInput,
): Promise<GenerateListenExportZipFileResult> {
  const exportedAt = new Date().toISOString();
  const utcYmd = exportedAt.slice(0, 10);
  const displayZipName = exportZipFilename(utcYmd, input.format);

  const artifactRelativePath = `${input.userId}/${input.exportJobId}.zip`;
  const baseResolved = path.resolve(input.artifactsBaseDir);
  const absFile = path.resolve(baseResolved, input.userId, `${input.exportJobId}.zip`);
  if (!absFile.startsWith(baseResolved + path.sep)) {
    throw new Error("refusing unsafe export artifact path");
  }

  const userDir = path.dirname(absFile);
  await mkdir(userDir, { recursive: true });
  await chmod(userDir, 0o700);

  if (input.exportJobProgress) {
    await resetExportJobListenProgress(input.pool, input.exportJobProgress);
  }

  let listensWritten = 0;
  const onListenBatch = async (batchLen: number): Promise<void> => {
    listensWritten += batchLen;
    if (input.exportJobProgress) {
      await updateExportJobListenProgress(input.pool, {
        exportJobId: input.exportJobProgress.exportJobId,
        userId: input.exportJobProgress.userId,
        itemsProcessed: listensWritten,
      });
    }
  };

  const output = createWriteStream(absFile);
  const archive = archiver("zip", { zlib: { level: 6 } });
  const entry = new PassThrough();
  archive.append(entry, {
    name: input.format === "json" ? "listens.json" : "listens.csv",
  });

  archive.on("error", () => {
    entry.destroy();
  });

  archive.pipe(output);

  const fillPromise = (async () => {
    try {
      if (input.format === "csv") {
        await pipeListensCsvTo(entry, input.pool, input.userId, onListenBatch);
      } else {
        await pipeListensJsonTo(entry, input.pool, input.userId, exportedAt, onListenBatch);
      }
      entry.end();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      entry.destroy(err);
      archive.abort();
      throw err;
    }
  })();

  const finalizePromise = archive.finalize();
  await fillPromise;
  await finalizePromise;
  await finished(output);
  await chmod(absFile, 0o600);

  return {
    artifactRelativePath,
    displayZipName,
    itemsProcessed: listensWritten,
  };
}
