/**
 * Fork-owned migration bookkeeping.
 *
 * Historical fork releases recorded their own migrations in upstream's
 * `effect_sql_migrations` ledger, claiming canonical ids that upstream later
 * reused (most recently 48 and 49). Effect's Migrator only runs ids above the
 * highest recorded id and ignores names, so every claimed id silently skips an
 * upstream migration. Fork state therefore lives in `t3code_fork_migrations`
 * and never writes to `effect_sql_migrations` again:
 *
 * - kind `canonical-replay`, key = upstream id: the upstream effect for that id
 *   was replayed here because a fork row claimed it (or it was missing).
 * - kind `fork`, key = fork migration number: fork-only schema, numbered
 *   independently of upstream.
 *
 * Existing `effect_sql_migrations` rows are never rewritten or removed.
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";

import {
  ensureForkSchemaColumns,
  forkSchemaBaseline,
  prepareForkMigrationPrerequisites,
} from "./LegacyForkCompatibility.ts";
import { seedAttachmentCleanupCursor } from "./SeedAttachmentCleanupCursor.ts";

type MigrationEffect = Effect.Effect<unknown, SqlError.SqlError, SqlClient.SqlClient>;

export type CanonicalMigrationEntry = readonly [id: number, name: string, effect: MigrationEffect];

/** Fork-only migrations, numbered independently of upstream. Append; never renumber. */
const forkMigrationEntries: ReadonlyArray<readonly [key: number, name: string, MigrationEffect]> = [
  [1, "ForkSchemaBaseline", forkSchemaBaseline],
  [2, "EnsureForkSchemaColumns", ensureForkSchemaColumns],
  [3, "SeedAttachmentCleanupCursor", seedAttachmentCleanupCursor],
];

/** Fork ledger names whose presence proves `ForkSchemaBaseline` already ran. */
const LEGACY_BASELINE_NAMES = [
  "RepairForkMigrationCompatibility",
  "RepairForkMigrationCompatibilityV2",
] as const;

/** The fork's V2 repair replayed the legacy repair and canonical 41–47. */
const LEGACY_V2_REPLAY_RANGE = { from: 16, to: 47 } as const;
/** Canonical ids with a known-safe replay. Later ids must never be claimed by the fork. */
const REPLAYABLE_RANGE = { from: 16, to: 49 } as const;
const LEGACY_PREREQUISITE_MAX_ID = 40;

const inRange = (id: number, range: { readonly from: number; readonly to: number }) =>
  id >= range.from && id <= range.to;

const tableExists = (sql: SqlClient.SqlClient, table: string) =>
  sql<{ readonly exists: number }>`
    SELECT EXISTS (
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${table}
    ) AS "exists"
  `.pipe(Effect.map((rows) => rows[0]?.exists === 1));

const ensureForkLedger = (sql: SqlClient.SqlClient) =>
  sql`
    CREATE TABLE IF NOT EXISTS t3code_fork_migrations (
      kind TEXT NOT NULL,
      key INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (kind, key)
    )
  `;

const readForkLedgerKeys = Effect.fn("readForkLedgerKeys")(function* (
  sql: SqlClient.SqlClient,
  kind: "canonical-replay" | "fork",
) {
  if (!(yield* tableExists(sql, "t3code_fork_migrations"))) return new Set<number>();
  const rows = yield* sql<{ readonly key: number }>`
    SELECT key FROM t3code_fork_migrations WHERE kind = ${kind}
  `;
  return new Set(rows.map((row) => row.key));
});

const recordForkLedgerRow = (
  sql: SqlClient.SqlClient,
  kind: "canonical-replay" | "fork",
  key: number,
  name: string,
) => sql`INSERT INTO t3code_fork_migrations (kind, key, name) VALUES (${kind}, ${key}, ${name})`;

const withImmediateTransaction = <A, E, R>(
  sql: SqlClient.SqlClient,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    sql`BEGIN IMMEDIATE`.unprepared,
    () => effect,
    (_, exit) =>
      (Exit.isSuccess(exit) ? sql`COMMIT`.unprepared : sql`ROLLBACK`.unprepared).pipe(Effect.orDie),
  );

const runRecordedMigration = (label: string, effect: MigrationEffect) =>
  effect.pipe(
    Effect.catch((cause) =>
      Effect.die(
        new Migrator.MigrationError({ cause, kind: "Failed", message: `${label} failed` }),
      ),
    ),
  );

const findSkippedCanonicalMigrations = Effect.fn("findSkippedCanonicalMigrations")(function* (
  sql: SqlClient.SqlClient,
  manifest: ReadonlyArray<CanonicalMigrationEntry>,
  throughId: number,
) {
  const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
    SELECT migration_id AS "migrationId", name
    FROM effect_sql_migrations
    WHERE migration_id <= ${throughId}
  `;
  const recorded = new Map(ledger.map((row) => [row.migrationId, row.name]));
  const replayed = yield* readForkLedgerKeys(sql, "canonical-replay");
  return manifest.filter(
    ([id, name]) => id <= throughId && recorded.get(id) !== name && !replayed.has(id),
  );
});

/**
 * Replays upstream effects the Migrator will never run because their ids at or
 * below `throughId` are missing or recorded under a fork name. Runs before the
 * Migrator so later canonical migrations see their prerequisites.
 */
export const replaySkippedCanonicalEffects = Effect.fn("replaySkippedCanonicalEffects")(function* (
  sql: SqlClient.SqlClient,
  manifest: ReadonlyArray<CanonicalMigrationEntry>,
  throughId: number,
) {
  // Cheap unlocked probe so healthy databases never take a write lock here.
  if ((yield* findSkippedCanonicalMigrations(sql, manifest, throughId)).length === 0) return;

  yield* withImmediateTransaction(
    sql,
    Effect.gen(function* () {
      const skipped = yield* findSkippedCanonicalMigrations(sql, manifest, throughId);
      if (skipped.length === 0) return;
      yield* ensureForkLedger(sql);

      const unsupported = skipped.filter(([id]) => !inRange(id, REPLAYABLE_RANGE));
      if (unsupported.length > 0) {
        return yield* new Migrator.MigrationError({
          kind: "BadState",
          message: `Canonical migrations ${unsupported
            .map(([id, name]) => `${id}_${name}`)
            .join(
              ", ",
            )} are claimed by fork ledger rows and have no replay. Refusing to start on a database that would silently skip them.`,
        });
      }

      const legacyV2Applied = yield* sql<{ readonly exists: number }>`
        SELECT EXISTS (
          SELECT 1 FROM effect_sql_migrations
          WHERE migration_id = 49 AND name = 'RepairForkMigrationCompatibilityV2'
        ) AS "exists"
      `.pipe(Effect.map((rows) => rows[0]?.exists === 1));
      const pending = legacyV2Applied
        ? skipped.filter(([id]) => !inRange(id, LEGACY_V2_REPLAY_RANGE))
        : skipped;

      if (pending.some(([id]) => id <= LEGACY_PREREQUISITE_MAX_ID)) {
        yield* prepareForkMigrationPrerequisites(
          sql,
          Math.min(throughId, LEGACY_PREREQUISITE_MAX_ID),
        );
      }
      for (const [id, name, effect] of pending) {
        if (id <= LEGACY_PREREQUISITE_MAX_ID) continue;
        yield* runRecordedMigration(`Replaying canonical migration "${id}_${name}"`, effect);
      }
      for (const [id, name] of skipped) {
        yield* recordForkLedgerRow(sql, "canonical-replay", id, name);
      }
      yield* Effect.log("Replayed canonical migrations skipped by the fork ledger").pipe(
        Effect.annotateLogs({
          replayed: pending.map(([id, name]) => `${id}_${name}`),
          seeded: skipped.filter((entry) => !pending.includes(entry)).map(([id]) => id),
        }),
      );
    }),
  );
});

const findPendingForkMigrations = Effect.fn("findPendingForkMigrations")(function* (
  sql: SqlClient.SqlClient,
) {
  const applied = yield* readForkLedgerKeys(sql, "fork");
  return forkMigrationEntries.filter(([key]) => !applied.has(key));
});

const isConstraintConflict = (error: SqlError.SqlError) =>
  error.reason._tag === "ConstraintError" || error.reason._tag === "UniqueViolation";

/**
 * Runs fork-only migrations after the canonical Migrator. Rows are inserted
 * before their effects run, so a concurrent runner that loses the key conflict
 * treats the work as already claimed.
 */
export const runForkMigrations = Effect.fn("runForkMigrations")(function* (
  sql: SqlClient.SqlClient,
) {
  if ((yield* findPendingForkMigrations(sql)).length === 0) return [];

  return yield* withImmediateTransaction(
    sql,
    Effect.gen(function* () {
      yield* ensureForkLedger(sql);
      const pending = yield* findPendingForkMigrations(sql);
      if (pending.length === 0) return [];

      const legacyBaselineApplied = yield* sql<{ readonly exists: number }>`
        SELECT EXISTS (
          SELECT 1 FROM effect_sql_migrations
          WHERE name IN ${sql.in(LEGACY_BASELINE_NAMES)}
        ) AS "exists"
      `.pipe(Effect.map((rows) => rows[0]?.exists === 1));

      for (const [key, name] of pending) {
        yield* recordForkLedgerRow(sql, "fork", key, name);
      }
      const executed: Array<readonly [key: number, name: string]> = [];
      for (const [key, name, effect] of pending) {
        if (key === 1 && legacyBaselineApplied) continue;
        yield* runRecordedMigration(`Fork migration "${key}_${name}"`, effect);
        executed.push([key, name]);
      }
      return executed;
    }),
  ).pipe(
    Effect.catchIf(
      (error): error is SqlError.SqlError =>
        SqlError.isSqlError(error) && isConstraintConflict(error),
      () =>
        Effect.logDebug("Fork migrations already claimed by another runner").pipe(
          Effect.as([] as ReadonlyArray<readonly [key: number, name: string]>),
        ),
    ),
  );
});
