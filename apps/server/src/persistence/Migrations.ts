/**
 * Migration runner with an inline loader.
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * `runMigrations` is called by the SQLite persistence layer at startup, so the
 * schema is always up to date before the application starts.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as Cause from "effect/Cause";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";

// Import all migrations statically
import Migration0001 from "./Migrations/001_OrchestrationEvents.ts";
import Migration0002 from "./Migrations/002_OrchestrationCommandReceipts.ts";
import Migration0003 from "./Migrations/003_CheckpointDiffBlobs.ts";
import Migration0004 from "./Migrations/004_ProviderSessionRuntime.ts";
import Migration0005 from "./Migrations/005_Projections.ts";
import Migration0006 from "./Migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./Migrations/007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./Migrations/008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./Migrations/009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./Migrations/010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./Migrations/011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./Migrations/012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./Migrations/013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./Migrations/014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./Migrations/015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./Migrations/016_CanonicalizeModelSelections.ts";
import Migration0017 from "./Migrations/017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./Migrations/018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./Migrations/019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./Migrations/020_AuthAccessManagement.ts";
import Migration0021 from "./Migrations/021_AuthSessionClientMetadata.ts";
import Migration0022 from "./Migrations/022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./Migrations/023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./Migrations/024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./Migrations/025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./Migrations/026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./Migrations/027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./Migrations/028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./Migrations/029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./Migrations/030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0031 from "./Migrations/031_AuthAuthorizationScopes.ts";
import Migration0032 from "./Migrations/032_AuthPairingProofKeyThumbprint.ts";
import Migration0033 from "./Migrations/033_ProjectionThreadsSettled.ts";
import Migration0034 from "./Migrations/034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./Migrations/035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./Migrations/036_ProjectionThreadsPinned.ts";
import Migration0037 from "./Migrations/037_ProjectionTurnsKeysetIndex.ts";
import Migration0038 from "./Migrations/038_ProjectionThreadsPinOrderKey.ts";
import Migration0039 from "./Migrations/039_ProjectionProjectsDefaultThreadEnvMode.ts";
import Migration0040 from "./Migrations/040_ProjectionProjectFaviconPath.ts";
import Migration0041 from "./Migrations/041_AuthSessionClientConnection.ts";
import Migration0042 from "./Migrations/042_ProjectionThreadLinkedPullRequest.ts";
import Migration0043 from "./Migrations/043_ProjectionThreadsUnsettledAt.ts";
import Migration0044 from "./Migrations/044_ClearAutomaticProjectModelDefaults.ts";
import Migration0045 from "./Migrations/045_ProjectionProjectsAutoPull.ts";
import Migration0046 from "./Migrations/046_RepairAutomaticSettlementTimestamps.ts";
import Migration0047 from "./Migrations/047_ProjectionProjectIcon.ts";
import Migration0048 from "./Migrations/048_ProjectionThreadBranchPullRequest.ts";
import Migration0049 from "./Migrations/049_ProjectionThreadsActiveOrderKey.ts";
import Migration0050 from "./Migrations/050_ProjectionThreadPullRequests.ts";
import Migration0051 from "./Migrations/051_ProjectionThreadMessageContext.ts";
import Migration0052 from "./Migrations/052_ProjectionThreadTitleState.ts";
import Migration0053 from "./Migrations/053_PullRequestFilesViewed.ts";
import {
  replaySkippedCanonicalEffects,
  runForkMigrations,
} from "./Migrations/Fork/ForkMigrations.ts";

/**
 * Migration loader with all migrations defined inline.
 *
 * Key format: "{id}_{name}" where:
 * - id: numeric migration ID (determines execution order)
 * - name: descriptive name for the migration
 *
 * Uses Migrator.fromRecord which parses the key format and
 * returns migrations sorted by ID.
 */
const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [3, "CheckpointDiffBlobs", Migration0003],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "CleanupInvalidProjectionPendingApprovals", Migration0025],
  [26, "CanonicalizeModelSelectionOptions", Migration0026],
  [27, "ProviderSessionRuntimeInstanceId", Migration0027],
  [28, "ProjectionThreadSessionInstanceId", Migration0028],
  [29, "ProjectionThreadDetailOrderingIndexes", Migration0029],
  [30, "ProjectionThreadShellArchiveIndexes", Migration0030],
  [31, "AuthAuthorizationScopes", Migration0031],
  [32, "AuthPairingProofKeyThumbprint", Migration0032],
  [33, "ProjectionThreadsSettled", Migration0033],
  [34, "ProjectionThreadsSnoozed", Migration0034],
  [35, "ProjectionThreadTitleRegeneration", Migration0035],
  [36, "ProjectionThreadsPinned", Migration0036],
  [37, "ProjectionTurnsKeysetIndex", Migration0037],
  [38, "ProjectionThreadsPinOrderKey", Migration0038],
  [39, "ProjectionProjectsDefaultThreadEnvMode", Migration0039],
  [40, "ProjectionProjectFaviconPath", Migration0040],
  [41, "AuthSessionClientConnection", Migration0041],
  [42, "ProjectionThreadLinkedPullRequest", Migration0042],
  [43, "ProjectionThreadsUnsettledAt", Migration0043],
  [44, "ClearAutomaticProjectModelDefaults", Migration0044],
  [45, "ProjectionProjectsAutoPull", Migration0045],
  [46, "RepairAutomaticSettlementTimestamps", Migration0046],
  [47, "ProjectionProjectIcon", Migration0047],
  [48, "ProjectionThreadBranchPullRequest", Migration0048],
  [49, "ProjectionThreadsActiveOrderKey", Migration0049],
  [50, "ProjectionThreadPullRequests", Migration0050],
  [51, "ProjectionThreadMessageContext", Migration0051],
  [52, "ProjectionThreadTitleState", Migration0052],
  [53, "PullRequestFilesViewed", Migration0053],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});
const migrationSemaphore = Semaphore.makeUnsafe(1);

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

const SQLITE_BUSY_SNAPSHOT = 517;
const SQLITE_BUSY = 5;
const MAX_SNAPSHOT_BUSY_RETRIES = 4;

const isSqliteBusySnapshot = (error: unknown): boolean => {
  if (SqlError.isSqlError(error)) {
    return isSqliteBusySnapshot(error.reason.cause);
  }
  if (error instanceof Migrator.MigrationError) {
    return isSqliteBusySnapshot(error.cause);
  }
  if (typeof error !== "object" || error === null) return false;

  const sqliteError = error as {
    readonly code?: unknown;
    readonly errcode?: unknown;
    readonly errno?: unknown;
  };
  return (
    sqliteError.code === "SQLITE_BUSY_SNAPSHOT" ||
    sqliteError.code === "SQLITE_BUSY" ||
    sqliteError.errcode === SQLITE_BUSY_SNAPSHOT ||
    sqliteError.errcode === SQLITE_BUSY ||
    sqliteError.errno === SQLITE_BUSY_SNAPSHOT ||
    sqliteError.errno === SQLITE_BUSY
  );
};

const causeContainsSqliteBusySnapshot = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.some((reason) => {
    if (Cause.isFailReason(reason)) return isSqliteBusySnapshot(reason.error);
    if (Cause.isDieReason(reason)) return isSqliteBusySnapshot(reason.defect);
    return false;
  });

/** Retries a migration attempt that lost a SQLite write race to another process. */
export const retryOnSqliteBusySnapshot = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  retriesRemaining = MAX_SNAPSHOT_BUSY_RETRIES,
  retryDelay: Duration.Input = "25 millis",
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.catchCauseIf(
      (cause) => retriesRemaining > 0 && causeContainsSqliteBusySnapshot(cause),
      () =>
        Effect.logWarning("Retrying migrations after concurrent SQLite contention").pipe(
          Effect.annotateLogs({ retriesRemaining }),
          Effect.andThen(Effect.sleep(retryDelay)),
          Effect.andThen(retryOnSqliteBusySnapshot(effect, retriesRemaining - 1, retryDelay)),
        ),
    ),
  );

const latestRecordedMigrationId = Effect.fn("latestRecordedMigrationId")(function* (
  sql: SqlClient.SqlClient,
) {
  const ledger = yield* sql<{ readonly exists: number }>`
    SELECT EXISTS (
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'effect_sql_migrations'
    ) AS "exists"
  `;
  if (ledger[0]?.exists !== 1) return 0;
  const latest = yield* sql<{ readonly migrationId: number }>`
    SELECT COALESCE(MAX(migration_id), 0) AS "migrationId" FROM effect_sql_migrations
  `;
  return latest[0]?.migrationId ?? 0;
});

/**
 * One migration pass: replay canonical effects skipped by fork ledger rows,
 * run pending canonical migrations, then (unbounded runs only) fork-only
 * migrations. See `Migrations/Fork/ForkMigrations.ts`.
 *
 * Returns array of [id, name] tuples for canonical migrations that were run.
 */
const runMigrationsAttempt = Effect.fn("runMigrationsAttempt")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const sql = yield* SqlClient.SqlClient;
  const latestMigrationId = yield* latestRecordedMigrationId(sql);
  const replayThroughId =
    toMigrationInclusive === undefined
      ? latestMigrationId
      : Math.min(latestMigrationId, toMigrationInclusive);
  if (replayThroughId > 0) {
    yield* replaySkippedCanonicalEffects(sql, migrationEntries, replayThroughId);
  }

  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  const forkMigrations = toMigrationInclusive === undefined ? yield* runForkMigrations(sql) : [];
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0 && forkMigrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(
        Effect.annotateLogs({
          migrations,
          forkMigrations: forkMigrations.map(([key, name]) => `fork_${key}_${name}`),
        }),
      );
  return executedMigrations;
});

/** Runs migrations without the in-process lock; for cross-process startup tests. */
export const runMigrationsUnserialized = Effect.fn("runMigrationsUnserialized")(
  (options: RunMigrationsOptions = {}) => retryOnSqliteBusySnapshot(runMigrationsAttempt(options)),
);

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")((options: RunMigrationsOptions = {}) =>
  migrationSemaphore.withPermit(runMigrationsUnserialized(options)),
);
