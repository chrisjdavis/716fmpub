import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

describe("migrations layout", () => {
  it("includes the initial users and sessions migration module", () => {
    const files = readdirSync(migrationsDir);
    const hasInitial = files.some(
      (name) =>
        name.endsWith(".cjs") && name.includes("initial-users-and-sessions"),
    );
    expect(hasInitial).toBe(true);
  });

  it("includes user imports and analytics migration module", () => {
    const files = readdirSync(migrationsDir);
    const hasFollowUp = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("user-imports-analytics-session-token-unique"),
    );
    expect(hasFollowUp).toBe(true);
  });

  it("includes core import jobs, raw scrobbles, and canonical listens migration", () => {
    const files = readdirSync(migrationsDir);
    const hasCore = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("core-schema-import-jobs-scrobbles-listens"),
    );
    expect(hasCore).toBe(true);
  });

  it("includes import job progress and completed-stage migration", () => {
    const files = readdirSync(migrationsDir);
    const hasProgress = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("import-job-progress-and-completed-stage"),
    );
    expect(hasProgress).toBe(true);
  });

  it("includes raw scrobbles source_event_hash dedupe migration", () => {
    const files = readdirSync(migrationsDir);
    const hasHash = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("raw-scrobbles-source-event-hash-dedupe"),
    );
    expect(hasHash).toBe(true);
  });

  it("includes import jobs lastfm username migration", () => {
    const files = readdirSync(migrationsDir);
    const hasCol = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("import-jobs-lastfm-username"),
    );
    expect(hasCol).toBe(true);
  });

  it("includes import job checkpoints migration", () => {
    const files = readdirSync(migrationsDir);
    const hasCp = files.some(
      (name) =>
        name.endsWith(".cjs") && name.includes("import-job-checkpoints"),
    );
    expect(hasCp).toBe(true);
  });

  it("includes canonicalization keys and raw status migration", () => {
    const files = readdirSync(migrationsDir);
    const hasCanon = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("canonicalization-keys-and-raw-status"),
    );
    expect(hasCanon).toBe(true);
  });

  it("includes users profile display and lastfm username migration", () => {
    const files = readdirSync(migrationsDir);
    const hasProfile = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("users-profile-display-lastfm-username"),
    );
    expect(hasProfile).toBe(true);
  });

  it("includes import jobs one active per user migration", () => {
    const files = readdirSync(migrationsDir);
    const hasIdx = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("import-jobs-one-active-per-user"),
    );
    expect(hasIdx).toBe(true);
  });

  it("includes export jobs one active per user migration", () => {
    const files = readdirSync(migrationsDir);
    const hasIdx = files.some(
      (name) =>
        name.endsWith(".cjs") &&
        name.includes("export-jobs-one-active-per-user"),
    );
    expect(hasIdx).toBe(true);
  });

  it("includes security audit events migration", () => {
    const files = readdirSync(migrationsDir);
    const hasAudit = files.some(
      (name) => name.endsWith(".cjs") && name.includes("security-audit-events"),
    );
    expect(hasAudit).toBe(true);
  });

  it("includes users account role and status migration", () => {
    const files = readdirSync(migrationsDir);
    const hasRoleStatus = files.some(
      (name) =>
        name.endsWith(".cjs") && name.includes("users-account-role-and-status"),
    );
    expect(hasRoleStatus).toBe(true);
  });

  it("includes admin audit events migration", () => {
    const files = readdirSync(migrationsDir);
    const hasAdminAudit = files.some(
      (name) => name.endsWith(".cjs") && name.includes("admin-audit-events"),
    );
    expect(hasAdminAudit).toBe(true);
  });

  it("includes beta invites migration", () => {
    const files = readdirSync(migrationsDir);
    const hasBetaInvites = files.some(
      (name) => name.endsWith(".cjs") && name.includes("beta-invites"),
    );
    expect(hasBetaInvites).toBe(true);
  });

  it("includes layer1 signal evidence and runs migration", () => {
    const files = readdirSync(migrationsDir);
    const hasLayer1 = files.some(
      (name) =>
        name.endsWith(".cjs") && name.includes("layer1-signal-evidence-and-runs"),
    );
    expect(hasLayer1).toBe(true);
  });

  it("includes layer1 evidence eligibility metadata migration", () => {
    const files = readdirSync(migrationsDir);
    const hasMeta = files.some(
      (name) =>
        name.endsWith(".cjs") && name.includes("layer1-evidence-eligibility-metadata"),
    );
    expect(hasMeta).toBe(true);
  });

  it("includes layer1 user recompute state migration", () => {
    const files = readdirSync(migrationsDir);
    const hasState = files.some(
      (name) =>
        name.endsWith(".cjs") && name.includes("layer1-user-recompute-state"),
    );
    expect(hasState).toBe(true);
  });
});
