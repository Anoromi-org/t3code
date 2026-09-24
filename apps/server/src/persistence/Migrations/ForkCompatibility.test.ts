// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectCreatedPayload, ThreadCreatedPayload } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlError from "effect/unstable/sql/SqlError";
import { DEFAULT_PROJECT_HYPRNAV_SETTINGS } from "@t3tools/contracts";

import { retryOnSqliteBusySnapshot, runMigrations } from "../Migrations.ts";
import * as SqliteClient from "@t3tools/shared/nodeSqliteClient";
import { ensureProjectionThreadForkOriginColumns } from "./Fork/ProjectionThreadsForkOrigin.ts";
import { ensureProjectionProjectHyprnavColumns } from "./Fork/ProjectionProjectsHyprnavSettings.ts";
import { normalizeProjectionProjectHyprnavRows } from "./Fork/NormalizeProjectHyprnavScopes.ts";
import { restoreInheritedProjectHyprnavNulls } from "./Fork/RestoreInheritedProjectHyprnavNulls.ts";
import { ensureProviderInstanceIdProjectionColumns } from "./Fork/RepairProviderInstanceIdProjectionColumns.ts";
import { ensureProviderSessionRuntimeIndexes } from "./Fork/ProviderSessionRuntimeIndexes.ts";
import { forkSchemaBaseline } from "./Fork/LegacyForkCompatibility.ts";
import { repairProjectionThreadLatestTurnIds } from "../Repairs/ProjectionThreadLatestTurnIds.ts";

const freshDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const forkDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const partialForkDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const authlessForkDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const cutoff23ForkDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const pre29ForkDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const previousRebuildDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const repaired42Database = it.layer(SqliteClient.layer({ filename: ":memory:" }));
const boundedForwardDatabase = it.layer(SqliteClient.layer({ filename: ":memory:" }));

const names = (rows: ReadonlyArray<{ readonly name: string }>) =>
  new Set(rows.map((row) => row.name));
const forkLedger = (sql: SqlClient.SqlClient) =>
  sql<{ readonly kind: string; readonly key: number }>`
    SELECT kind, key FROM t3code_fork_migrations ORDER BY kind, key
  `.pipe(Effect.map((rows) => rows.map((row) => [row.kind, row.key] as const)));
const decodeProjectCreatedPayload = Schema.decodeUnknownSync(ProjectCreatedPayload);
const decodeThreadCreatedPayload = Schema.decodeUnknownSync(ThreadCreatedPayload);

it.effect("retries typed and wrapped SQLite snapshot contention", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const sqliteCause = Object.assign(new Error("database is locked"), { errcode: 517 });
    const sqlError = new SqlError.SqlError({
      reason: new SqlError.UnknownError({ cause: sqliteCause }),
    });
    const busyError = new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: Object.assign(new Error("database is locked"), { errcode: 5 }),
      }),
    });
    const migrationError = new Migrator.MigrationError({
      cause: sqlError,
      kind: "Failed",
      message: "migration failed",
    });
    const attempt = Ref.updateAndGet(attempts, (value) => value + 1).pipe(
      Effect.flatMap((number) => {
        if (number === 1) return Effect.fail(sqlError);
        if (number === 2) return Effect.die(migrationError);
        if (number === 3) return Effect.fail(busyError);
        return Effect.succeed("migrated");
      }),
    );

    assert.equal(yield* retryOnSqliteBusySnapshot(attempt, 4, 0), "migrated");
    assert.equal(yield* Ref.get(attempts), 4);
  }),
);

it.effect("does not retry non-contention failures", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const failure = new Error("migration invariant failed");
    const error = yield* Ref.update(attempts, (value) => value + 1).pipe(
      Effect.andThen(Effect.fail(failure)),
      (attempt) => retryOnSqliteBusySnapshot(attempt, 4, 0),
      Effect.flip,
    );

    assert.strictEqual(error, failure);
    assert.equal(yield* Ref.get(attempts), 1);
  }),
);

it.effect("returns the contention failure after exhausting retries", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const failure = new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: Object.assign(new Error("database is locked"), { errcode: 5 }),
      }),
    });
    const error = yield* Ref.update(attempts, (value) => value + 1).pipe(
      Effect.andThen(Effect.fail(failure)),
      (attempt) => retryOnSqliteBusySnapshot(attempt, 2, 0),
      Effect.flip,
    );

    assert.strictEqual(error, failure);
    assert.equal(yield* Ref.get(attempts), 3);
  }),
);

const makeMigrationProcess = (filename: string) => {
  const fixture = NodeURL.fileURLToPath(
    new URL("./ConcurrentMigrationStartup.fixture.ts", import.meta.url),
  );
  const child = NodeChildProcess.fork(fixture, [filename], {
    execPath: process.execPath,
    silent: true,
  });
  let stdout = "";
  let stderr = "";
  let markReady: () => void = () => undefined;
  let rejectReady: (error: Error) => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    rejectReady = reject;
  });
  let markContention: () => void = () => undefined;
  const contention = new Promise<void>((resolve) => {
    markContention = resolve;
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
    if (stdout.includes("Retrying migrations after concurrent SQLite contention")) {
      markContention();
    }
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("message", (message) => {
    if (message === "ready") markReady();
  });
  const completion = new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      rejectReady(error);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const error = new Error(
        `Migration process exited with code ${String(code)} and signal ${String(signal)}:\n${stdout}\n${stderr}`,
      );
      rejectReady(error);
      reject(error);
    });
  });
  void completion.catch(() => undefined);

  return {
    completion,
    contention,
    ready,
    start: () => child.send("start"),
  };
};

it.effect("completes concurrent repair startup across two independent runtimes", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-migrations-" });
    const filename = path.join(directory, "state.sqlite");
    const provideDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
      effect.pipe(Effect.provide(SqliteClient.layer({ filename })));
    yield* provideDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 34 });
        const formerNames = [
          "ProjectionThreadsForkOrigin",
          "ProjectionProjectsHyprnavSettings",
          "NormalizeProjectHyprnavScopes",
          "RestoreInheritedProjectHyprnavNulls",
          "RepairProviderInstanceIdProjectionColumns",
          "RepairProjectionThreadLatestTurnIds",
          "ProviderSessionRuntimeIndexes",
          "RepairForkMigrationCompatibility",
        ];
        for (const [offset, name] of formerNames.entries()) {
          yield* sql`
                INSERT INTO effect_sql_migrations (migration_id, name)
                VALUES (${35 + offset}, ${name})
              `;
        }
      }),
    );

    const first = makeMigrationProcess(filename);
    const second = makeMigrationProcess(filename);
    yield* Effect.tryPromise(() => Promise.all([first.ready, second.ready]));
    yield* provideDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql.unsafe("BEGIN IMMEDIATE");
        first.start();
        second.start();
        yield* Effect.tryPromise(() => Promise.race([first.contention, second.contention]));
        yield* sql.unsafe("COMMIT");
      }),
    );
    yield* Effect.tryPromise(() => Promise.all([first.completion, second.completion]));

    yield* provideDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const ledger = yield* sql<{
          readonly migrationId: number;
          readonly count: number;
        }>`
              SELECT migration_id AS "migrationId", COUNT(*) AS count
              FROM effect_sql_migrations
              GROUP BY migration_id
              ORDER BY migration_id
            `;
        assert.equal(ledger.at(-1)?.migrationId, 53);
        assert.isTrue(ledger.every((row) => row.count === 1));
        assert.deepEqual(yield* forkLedger(sql), [
          ...[35, 36, 37, 38, 39, 40, 41, 42].map((key) => ["canonical-replay", key] as const),
          ["fork", 1],
          ["fork", 2],
          ["fork", 3],
        ]);

        const threadColumns = names(
          yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
        );
        const projectColumns = names(
          yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`,
        );
        assert.equal(threadColumns.has("title_regeneration_request_id"), true);
        assert.equal(threadColumns.has("fork_source_thread_id"), true);
        assert.equal(projectColumns.has("favicon_path"), true);
        assert.equal(projectColumns.has("hyprnav_json"), true);
        assert.deepEqual(yield* sql`PRAGMA quick_check`.values, [["ok"]]);
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

freshDatabase("fork compatibility fresh database", (it) => {
  it.effect("applies the canonical and fork migrations on a fresh database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'canonical-project', 'Canonical Project', '/tmp/canonical', NULL,
          '[]', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, branch, worktree_path, latest_turn_id, created_at,
          updated_at, archived_at, latest_user_message_at, pending_approval_count,
          pending_user_input_count, has_actionable_proposed_plan, deleted_at
        ) VALUES (
          'canonical-thread', 'canonical-project', 'Canonical Thread',
          '{"provider":"codex","model":"gpt-5"}', 'full-access', 'default',
          NULL, NULL, NULL, '2026-07-01T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z', NULL, NULL, 0, 0, 0, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, state, requested_at, started_at, completed_at,
          checkpoint_files_json
        ) VALUES (
          'canonical-thread', 'settled-turn', 'completed', '2026-07-01T00:01:00.000Z',
          '2026-07-01T00:01:01.000Z', '2026-07-01T00:02:00.000Z', '[]'
        )
      `;
      yield* runMigrations();

      const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id >= 31
        ORDER BY migration_id
      `;
      assert.deepEqual(ledger, [
        { migrationId: 31, name: "AuthAuthorizationScopes" },
        { migrationId: 32, name: "AuthPairingProofKeyThumbprint" },
        { migrationId: 33, name: "ProjectionThreadsSettled" },
        { migrationId: 34, name: "ProjectionThreadsSnoozed" },
        { migrationId: 35, name: "ProjectionThreadTitleRegeneration" },
        { migrationId: 36, name: "ProjectionThreadsPinned" },
        { migrationId: 37, name: "ProjectionTurnsKeysetIndex" },
        { migrationId: 38, name: "ProjectionThreadsPinOrderKey" },
        { migrationId: 39, name: "ProjectionProjectsDefaultThreadEnvMode" },
        { migrationId: 40, name: "ProjectionProjectFaviconPath" },
        { migrationId: 41, name: "AuthSessionClientConnection" },
        { migrationId: 42, name: "ProjectionThreadLinkedPullRequest" },
        { migrationId: 43, name: "ProjectionThreadsUnsettledAt" },
        { migrationId: 44, name: "ClearAutomaticProjectModelDefaults" },
        { migrationId: 45, name: "ProjectionProjectsAutoPull" },
        { migrationId: 46, name: "RepairAutomaticSettlementTimestamps" },
        { migrationId: 47, name: "ProjectionProjectIcon" },
        { migrationId: 48, name: "ProjectionThreadBranchPullRequest" },
        { migrationId: 49, name: "ProjectionThreadsActiveOrderKey" },
        { migrationId: 50, name: "ProjectionThreadPullRequests" },
        { migrationId: 51, name: "ProjectionThreadMessageContext" },
        { migrationId: 52, name: "ProjectionThreadTitleState" },
        { migrationId: 53, name: "PullRequestFilesViewed" },
      ]);
      assert.deepEqual(yield* forkLedger(sql), [
        ["fork", 1],
        ["fork", 2],
        ["fork", 3],
      ]);
      const freshProjectColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`,
      );
      assert.equal(freshProjectColumns.has("hyprnav_json"), true);
      assert.deepEqual(yield* runMigrations(), []);

      const pairingColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_pairing_links)`,
      );
      assert.equal(pairingColumns.has("scopes"), true);
      assert.equal(pairingColumns.has("role"), false);
      assert.equal(pairingColumns.has("proof_key_thumbprint"), true);
      const canonicalThread = yield* sql<{ readonly latestTurnId: string | null }>`
        SELECT latest_turn_id AS "latestTurnId"
        FROM projection_threads
        WHERE thread_id = 'canonical-thread'
      `;
      assert.deepEqual(canonicalThread, [{ latestTurnId: null }]);
    }),
  );
});

previousRebuildDatabase("fork compatibility previous rebuild", (it) => {
  it.effect("repairs the previous 34-41 ledger while preserving its historical names", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 33 });
      yield* ensureProjectionThreadForkOriginColumns(sql);
      yield* ensureProjectionProjectHyprnavColumns(sql);
      yield* normalizeProjectionProjectHyprnavRows(sql);
      yield* restoreInheritedProjectHyprnavNulls(sql);
      yield* ensureProviderInstanceIdProjectionColumns(sql);
      yield* repairProjectionThreadLatestTurnIds(sql, { backfillMissing: false });
      yield* ensureProviderSessionRuntimeIndexes(sql);

      const historicalNames = [
        "ProjectionThreadsForkOrigin",
        "ProjectionProjectsHyprnavSettings",
        "NormalizeProjectHyprnavScopes",
        "RestoreInheritedProjectHyprnavNulls",
        "RepairProviderInstanceIdProjectionColumns",
        "RepairProjectionThreadLatestTurnIds",
        "ProviderSessionRuntimeIndexes",
        "RepairForkMigrationCompatibility",
      ];
      for (const [offset, name] of historicalNames.entries()) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (${34 + offset}, ${name})
        `;
      }

      const executed = yield* runMigrations();
      assert.deepEqual(executed.at(0), [42, "ProjectionThreadLinkedPullRequest"]);
      assert.deepEqual(executed.at(-1), [53, "PullRequestFilesViewed"]);

      const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 34 AND 53
        ORDER BY migration_id
      `;
      assert.deepEqual(
        ledger.slice(0, 8).map((row) => row.name),
        historicalNames,
      );
      assert.deepEqual(ledger.at(-1), {
        migrationId: 53,
        name: "PullRequestFilesViewed",
      });
      // The historical RepairForkMigrationCompatibility row proves the baseline already ran.
      assert.deepEqual((yield* forkLedger(sql)).slice(-3), [
        ["fork", 1],
        ["fork", 2],
        ["fork", 3],
      ]);

      const threadColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
      );
      assert.equal(threadColumns.has("settled_override"), true);
      assert.equal(threadColumns.has("settled_at"), true);
      assert.equal(threadColumns.has("snoozed_until"), true);
      assert.equal(threadColumns.has("snoozed_at"), true);
    }),
  );
});

repaired42Database("fork compatibility former repair 42", (it) => {
  it.effect("preserves the former 35-42 ledger and restores canonical 35-40 effects", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* ensureProjectionThreadForkOriginColumns(sql);
      yield* ensureProjectionProjectHyprnavColumns(sql);
      yield* normalizeProjectionProjectHyprnavRows(sql);
      yield* restoreInheritedProjectHyprnavNulls(sql);
      yield* ensureProviderInstanceIdProjectionColumns(sql);
      yield* repairProjectionThreadLatestTurnIds(sql, { backfillMissing: false });
      yield* ensureProviderSessionRuntimeIndexes(sql);

      const formerNames = [
        "ProjectionThreadsForkOrigin",
        "ProjectionProjectsHyprnavSettings",
        "NormalizeProjectHyprnavScopes",
        "RestoreInheritedProjectHyprnavNulls",
        "RepairProviderInstanceIdProjectionColumns",
        "RepairProjectionThreadLatestTurnIds",
        "ProviderSessionRuntimeIndexes",
        "RepairForkMigrationCompatibility",
      ];
      for (const [offset, name] of formerNames.entries()) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (${35 + offset}, ${name})
        `;
      }

      const executed = yield* runMigrations();
      assert.deepEqual(
        executed.map(([id, name]) => [id, name]),
        [
          [43, "ProjectionThreadsUnsettledAt"],
          [44, "ClearAutomaticProjectModelDefaults"],
          [45, "ProjectionProjectsAutoPull"],
          [46, "RepairAutomaticSettlementTimestamps"],
          [47, "ProjectionProjectIcon"],
          [48, "ProjectionThreadBranchPullRequest"],
          [49, "ProjectionThreadsActiveOrderKey"],
          [50, "ProjectionThreadPullRequests"],
          [51, "ProjectionThreadMessageContext"],
          [52, "ProjectionThreadTitleState"],
          [53, "PullRequestFilesViewed"],
        ],
      );

      const historicalLedger = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 35 AND 42
        ORDER BY migration_id
      `;
      assert.deepEqual(
        historicalLedger.map((row) => row.name),
        formerNames,
      );

      const threadColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
      );
      const projectColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`,
      );
      assert.equal(threadColumns.has("title_regeneration_request_id"), true);
      assert.equal(threadColumns.has("pinned_at"), true);
      assert.equal(threadColumns.has("pin_order_key"), true);
      assert.equal(projectColumns.has("default_thread_env_mode"), true);
      assert.equal(projectColumns.has("favicon_path"), true);

      const quickCheck = yield* sql`PRAGMA quick_check`.values;
      assert.deepEqual(quickCheck, [["ok"]]);
    }),
  );
});

boundedForwardDatabase("fork compatibility bounded forward repair", (it) => {
  it.effect("repairs only canonical effects already claimed by the divergent ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 15 });
      for (let migrationId = 16; migrationId <= 20; migrationId += 1) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (${migrationId}, ${`HistoricalFork${migrationId}`})
        `;
      }

      const executed = yield* runMigrations({ toMigrationInclusive: 21 });
      assert.deepEqual(
        executed.map(([id, name]) => [id, name]),
        [[21, "AuthSessionClientMetadata"]],
      );

      const pairingColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_pairing_links)`,
      );
      const threadColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
      );
      const projectColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`,
      );
      assert.equal(threadColumns.has("model"), false);
      assert.equal(projectColumns.has("default_model"), false);
      assert.equal(pairingColumns.has("role"), true);
      assert.equal(pairingColumns.has("scopes"), false);
      assert.equal(pairingColumns.has("proof_key_thumbprint"), false);
      assert.equal(threadColumns.has("title_regeneration_request_id"), false);
      assert.equal(threadColumns.has("pinned_at"), false);
      assert.equal(threadColumns.has("pin_order_key"), false);
      assert.equal(projectColumns.has("default_thread_env_mode"), false);
      assert.equal(projectColumns.has("favicon_path"), false);

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'bounded-project', 'Bounded Project', '/tmp/bounded', NULL,
          '[]', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, branch, worktree_path, latest_turn_id, created_at,
          updated_at, archived_at, deleted_at
        ) VALUES (
          'bounded-thread', 'bounded-project', 'Bounded Thread',
          '{"provider":"codex","model":"gpt-5"}', 'full-access', 'default',
          NULL, NULL, NULL, '2026-07-01T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z', NULL, NULL
        )
      `;
    }),
  );
});

partialForkDatabase("fork compatibility partial fork database", (it) => {
  it.effect("prepares canonical prerequisites before colliding fork ledgers resume", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 15 });
      yield* ensureProjectionThreadForkOriginColumns(sql);
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'partial-project', 'Partial Fork', '/tmp/partial-fork', 'gpt-5', '[]',
          '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'partial-thread', 'partial-project', 'Partial Thread', 'gpt-5',
          'full-access', 'default', NULL, NULL, NULL,
          '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (16, 'ProjectionThreadsForkOrigin'),
          (17, 'ProjectionThreadsForkOriginCompatibility')
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, command_id, causation_event_id, correlation_id,
          actor_kind, payload_json, metadata_json
        ) VALUES
          (
            'partial-project-created', 'project', 'partial-project', 0,
            'project.created', '2026-07-01T00:00:00.000Z', NULL, NULL, NULL,
            'client',
            '{"projectId":"partial-project","title":"Partial Fork","workspaceRoot":"/tmp/partial-fork","defaultProvider":"codex","defaultModel":"gpt-5","defaultModelOptions":{},"scripts":[],"createdAt":"2026-07-01T00:00:00.000Z","updatedAt":"2026-07-01T00:00:00.000Z"}',
            '{}'
          ),
          (
            'partial-thread-created', 'thread', 'partial-thread', 0,
            'thread.created', '2026-07-01T00:00:00.000Z', NULL, NULL, NULL,
            'client',
            '{"threadId":"partial-thread","projectId":"partial-project","title":"Partial Thread","provider":"codex","model":"gpt-5","modelOptions":{},"runtimeMode":"full-access","interactionMode":"default","branch":null,"worktreePath":null,"createdAt":"2026-07-01T00:00:00.000Z","updatedAt":"2026-07-01T00:00:00.000Z"}',
            '{}'
          )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, state, requested_at, started_at, completed_at,
          checkpoint_turn_count, checkpoint_ref, checkpoint_status, checkpoint_files_json
        ) VALUES (
          'partial-thread', 'partial-turn', 'completed',
          '2026-07-01T00:01:00.000Z', '2026-07-01T00:01:00.000Z',
          '2026-07-01T00:02:00.000Z', 1, 'refs/partial-turn', 'ready', '[]'
        )
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, command_id, causation_event_id, correlation_id,
          actor_kind, payload_json, metadata_json
        ) VALUES (
          'partial-turn-diff', 'thread', 'partial-thread', 1,
          'thread.turn-diff-completed', '2026-07-01T00:02:00.000Z',
          NULL, NULL, NULL, 'provider',
          '{"threadId":"partial-thread","turnId":"partial-turn","checkpointTurnCount":1,"checkpointRef":"refs/partial-turn","status":"ready","files":[],"assistantMessageId":null,"completedAt":"2026-07-01T00:02:00.000Z"}',
          '{}'
        )
      `;

      yield* runMigrations();

      const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id IN (16, 17, 53)
        ORDER BY migration_id
      `;
      const selection = yield* sql<{ readonly model: string | null }>`
        SELECT json_extract(model_selection_json, '$.model') AS model
        FROM projection_threads
        WHERE thread_id = 'partial-thread'
      `;
      const latestTurn = yield* sql<{ readonly latestTurnId: string | null }>`
        SELECT latest_turn_id AS "latestTurnId"
        FROM projection_threads
        WHERE thread_id = 'partial-thread'
      `;
      const projectColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`,
      );
      const threadColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
      );
      const eventPayloads = yield* sql<{ readonly eventType: string; readonly payload: string }>`
        SELECT event_type AS "eventType", payload_json AS payload
        FROM orchestration_events
        WHERE event_id IN ('partial-project-created', 'partial-thread-created')
        ORDER BY event_type
      `;

      assert.deepEqual(ledger, [
        { migrationId: 16, name: "ProjectionThreadsForkOrigin" },
        { migrationId: 17, name: "ProjectionThreadsForkOriginCompatibility" },
        { migrationId: 53, name: "PullRequestFilesViewed" },
      ]);
      assert.deepEqual(selection, [{ model: "gpt-5" }]);
      assert.deepEqual(latestTurn, [{ latestTurnId: "partial-turn" }]);
      assert.equal(projectColumns.has("default_model"), false);
      assert.equal(threadColumns.has("model"), false);
      assert.equal(threadColumns.has("archived_at"), true);
      assert.doesNotThrow(() => decodeProjectCreatedPayload(JSON.parse(eventPayloads[0]!.payload)));
      assert.doesNotThrow(() => decodeThreadCreatedPayload(JSON.parse(eventPayloads[1]!.payload)));
    }),
  );
});

authlessForkDatabase("fork compatibility authless fork database", (it) => {
  it.effect("prepares a historical migration-20 ledger during bounded forward migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 15 });
      yield* ensureProjectionThreadForkOriginColumns(sql);
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (16, 'ProjectionThreadsForkOrigin'),
          (17, 'ProjectionThreadsForkOriginCompat'),
          (18, 'CanonicalizeModelSelections'),
          (19, 'ProjectionProjectsWorktreeGroupTitles'),
          (20, 'RepairForkedMigrationDrift')
      `;

      yield* runMigrations({ toMigrationInclusive: 49 });

      const finalMigration = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        ORDER BY migration_id DESC
        LIMIT 1
      `;
      const pairingColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_pairing_links)`,
      );
      const sessionColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`,
      );

      assert.deepEqual(finalMigration, [
        { migrationId: 49, name: "ProjectionThreadsActiveOrderKey" },
      ]);
      assert.equal(pairingColumns.has("scopes"), true);
      assert.equal(pairingColumns.has("proof_key_thumbprint"), true);
      assert.equal(sessionColumns.has("scopes"), true);
    }),
  );
});

cutoff23ForkDatabase("fork compatibility migration-23 fork database", (it) => {
  it.effect("creates shell-summary prerequisites before canonical migration 24", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 15 });
      yield* ensureProjectionThreadForkOriginColumns(sql);
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (16, 'ProjectionThreadsForkOrigin'),
          (17, 'ProjectionThreadsForkOriginCompat'),
          (18, 'CanonicalizeModelSelections'),
          (19, 'ProjectionProjectsWorktreeGroupTitles'),
          (20, 'RepairForkedMigrationDrift'),
          (21, 'ProjectionThreadsForkOriginCompatBackfill'),
          (22, 'ProjectionThreadsArchivedAtCompatBackfill'),
          (23, 'ProjectionThreadsArchivedAtIndexCompatBackfill')
      `;

      yield* runMigrations();

      const threadColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
      );
      assert.equal(threadColumns.has("latest_user_message_at"), true);
      assert.equal(threadColumns.has("pending_approval_count"), true);
      assert.equal(threadColumns.has("pending_user_input_count"), true);
      assert.equal(threadColumns.has("has_actionable_proposed_plan"), true);
    }),
  );
});

pre29ForkDatabase("fork compatibility pre-29 fork database", (it) => {
  it.effect("backfills a missing latest-turn pointer when no authoritative event exists", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 15 });
      yield* ensureProjectionThreadForkOriginColumns(sql);
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'pre29-project', 'Pre-29 Fork', '/tmp/pre29-fork', 'gpt-5', '[]',
          '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, created_at, updated_at, deleted_at
        ) VALUES (
          'pre29-thread', 'pre29-project', 'Pre-29 Thread', 'gpt-5',
          'full-access', 'default', NULL, NULL, NULL,
          '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, state, requested_at, started_at, completed_at,
          checkpoint_files_json
        ) VALUES (
          'pre29-thread', 'pre29-turn', 'completed',
          '2026-07-01T00:01:00.000Z', '2026-07-01T00:01:01.000Z',
          '2026-07-01T00:02:00.000Z', '[]'
        )
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (16, 'ProjectionThreadsForkOrigin'),
          (17, 'ProjectionThreadsForkOriginCompat'),
          (18, 'CanonicalizeModelSelections'),
          (19, 'ProjectionProjectsWorktreeGroupTitles'),
          (20, 'RepairForkedMigrationDrift'),
          (21, 'ProjectionThreadsForkOriginCompatBackfill'),
          (22, 'ProjectionThreadsArchivedAtCompatBackfill'),
          (23, 'ProjectionThreadsArchivedAtIndexCompatBackfill'),
          (24, 'BackfillProjectionThreadShellSummary'),
          (25, 'CleanupInvalidProjectionPendingApprovals'),
          (26, 'ProjectionProjectsWorktreeGroupTitles'),
          (27, 'RepairForkedMigrationDrift'),
          (28, 'RepairMissingAuthAccessTables')
      `;

      yield* runMigrations();

      const latestTurn = yield* sql<{ readonly latestTurnId: string | null }>`
        SELECT latest_turn_id AS "latestTurnId"
        FROM projection_threads
        WHERE thread_id = 'pre29-thread'
      `;
      assert.deepEqual(latestTurn, [{ latestTurnId: "pre29-turn" }]);
    }),
  );
});

forkDatabase("fork compatibility fork database", (it) => {
  it.effect("repairs a historical fork ledger without rewriting it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 30 });
      yield* sql`
        UPDATE effect_sql_migrations
        SET name = CASE migration_id
          WHEN 19 THEN 'ProjectionProjectsWorktreeGroupTitles'
          WHEN 26 THEN 'ProjectionProjectsWorktreeGroupTitles'
          WHEN 29 THEN 'RepairProjectionThreadLatestTurnIds'
          WHEN 30 THEN 'ProjectionProjectsHyprnavSettings'
        END
        WHERE migration_id IN (19, 26, 29, 30)
      `;
      yield* sql`DROP INDEX idx_projection_projects_workspace_root_deleted_at`;
      yield* sql`DROP INDEX idx_projection_threads_project_deleted_created`;
      yield* sql`DROP INDEX idx_projection_threads_project_archived_at`;
      yield* sql`DROP INDEX idx_projection_thread_activities_thread_sequence_created_id`;
      yield* sql`DROP INDEX idx_projection_thread_messages_thread_created_id`;
      yield* sql`DROP INDEX idx_projection_threads_shell_active`;
      yield* sql`DROP INDEX idx_projection_threads_shell_archived`;
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN model TEXT NOT NULL DEFAULT 'gpt-5'
      `;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'fork-project', 'Fork Project', '/tmp/fork-project', NULL,
          '[]', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model, model_selection_json, runtime_mode,
          interaction_mode, branch, worktree_path, latest_turn_id, created_at,
          updated_at, archived_at, latest_user_message_at, pending_approval_count,
          pending_user_input_count, has_actionable_proposed_plan, deleted_at
        ) VALUES (
          'fork-thread', 'fork-project', 'Fork Thread', 'gpt-5',
          '{"provider":"codex","model":"gpt-5","options":{"effort":"high","fastMode":true}}',
          'full-access', 'default',
          NULL, NULL, 'fork-turn', '2026-07-01T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z', NULL, NULL, 0, 0, 0, NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, state, requested_at, started_at, completed_at,
          checkpoint_files_json
        ) VALUES (
          'fork-thread', 'fork-turn', 'completed', '2026-07-01T00:01:00.000Z',
          '2026-07-01T00:01:01.000Z', '2026-07-01T00:02:00.000Z', '[]'
        )
      `;
      yield* sql`
        INSERT INTO orchestration_events (
          event_id, aggregate_kind, stream_id, stream_version, event_type,
          occurred_at, command_id, causation_event_id, correlation_id,
          actor_kind, payload_json, metadata_json
        ) VALUES (
          'fork-session-ended', 'thread', 'fork-thread', 0,
          'thread.session-set', '2026-07-01T00:02:01.000Z',
          NULL, NULL, NULL, 'server',
          '{"threadId":"fork-thread","session":{"threadId":"fork-thread","status":"ready","providerName":"codex","runtimeMode":"full-access","activeTurnId":null,"lastError":null,"updatedAt":"2026-07-01T00:02:01.000Z"}}',
          '{}'
        )
      `;

      yield* ensureProjectionThreadForkOriginColumns(sql);
      yield* sql.unsafe(`
        ALTER TABLE projection_projects
        ADD COLUMN hyprnav_json TEXT NOT NULL DEFAULT
          '{"bindings":[{"id":"worktree-terminal","slot":1,"action":"worktree-terminal"},{"id":"open-favorite-editor","slot":2,"action":"open-favorite-editor"}]'
      `);
      yield* sql`
        ALTER TABLE projection_projects
        ADD COLUMN worktree_group_titles_json TEXT NOT NULL DEFAULT '[]'
      `;
      yield* normalizeProjectionProjectHyprnavRows(sql);
      yield* restoreInheritedProjectHyprnavNulls(sql);
      yield* ensureProviderInstanceIdProjectionColumns(sql);
      yield* ensureProviderSessionRuntimeIndexes(sql);

      const historicalNames = [
        "NormalizeProjectHyprnavScopes",
        "RestoreInheritedProjectHyprnavNulls",
        "RepairProviderInstanceIdProjectionColumns",
        "RepairProjectionThreadLatestTurnIds",
        "ProviderSessionRuntimeIndexes",
        "HistoricalForkReserved36",
        "HistoricalForkReserved37",
      ];
      for (const [offset, name] of historicalNames.entries()) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (${31 + offset}, ${name})
        `;
      }

      const bounded = yield* runMigrations({ toMigrationInclusive: 30 });
      const boundedThreadColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
      );
      const boundedSessionColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`,
      );
      assert.deepEqual(bounded, []);
      assert.equal(boundedThreadColumns.has("model"), false);
      assert.equal(boundedSessionColumns.has("role"), true);

      const executed = yield* runMigrations();
      assert.deepEqual(
        executed.map(([id, name]) => [id, name]),
        [
          [38, "ProjectionThreadsPinOrderKey"],
          [39, "ProjectionProjectsDefaultThreadEnvMode"],
          [40, "ProjectionProjectFaviconPath"],
          [41, "AuthSessionClientConnection"],
          [42, "ProjectionThreadLinkedPullRequest"],
          [43, "ProjectionThreadsUnsettledAt"],
          [44, "ClearAutomaticProjectModelDefaults"],
          [45, "ProjectionProjectsAutoPull"],
          [46, "RepairAutomaticSettlementTimestamps"],
          [47, "ProjectionProjectIcon"],
          [48, "ProjectionThreadBranchPullRequest"],
          [49, "ProjectionThreadsActiveOrderKey"],
          [50, "ProjectionThreadPullRequests"],
          [51, "ProjectionThreadMessageContext"],
          [52, "ProjectionThreadTitleState"],
          [53, "PullRequestFilesViewed"],
        ],
      );

      const historicalLedger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 31 AND 37
        ORDER BY migration_id
      `;
      assert.deepEqual(
        historicalLedger.map((row) => row.name),
        historicalNames,
      );
      const earlierForkLedger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id IN (19, 26, 29, 30)
        ORDER BY migration_id
      `;
      assert.deepEqual(earlierForkLedger, [
        { migrationId: 19, name: "ProjectionProjectsWorktreeGroupTitles" },
        { migrationId: 26, name: "ProjectionProjectsWorktreeGroupTitles" },
        { migrationId: 29, name: "RepairProjectionThreadLatestTurnIds" },
        { migrationId: 30, name: "ProjectionProjectsHyprnavSettings" },
      ]);

      yield* sql`
        INSERT /* post-compatibility project */ INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, hyprnav_json, created_at, updated_at, deleted_at
        ) VALUES (
          'post-repair-project', 'Post Repair', '/tmp/post-repair', NULL,
          '[]', 'null', '2026-07-01T00:03:00.000Z', '2026-07-01T00:03:00.000Z', NULL
        )
      `.unprepared;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, branch, worktree_path, latest_turn_id, created_at,
          updated_at, archived_at, latest_user_message_at, pending_approval_count,
          pending_user_input_count, has_actionable_proposed_plan, deleted_at
        ) VALUES (
          'post-repair-thread', 'fork-project', 'Post Repair',
          '{"provider":"codex","model":"gpt-5"}', 'full-access', 'default',
          NULL, NULL, NULL, '2026-07-01T00:03:00.000Z',
          '2026-07-01T00:03:00.000Z', NULL, NULL, 0, 0, 0, NULL
        )
      `;

      const sessionColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`,
      );
      const projectColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`,
      );
      const threadColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
      );
      const latestTurn = yield* sql<{ readonly latestTurnId: string | null }>`
        SELECT latest_turn_id AS "latestTurnId"
        FROM projection_threads
        WHERE thread_id = 'fork-thread'
      `;
      const modelOptions = yield* sql<{ readonly optionType: string | null }>`
        SELECT json_type(model_selection_json, '$.options') AS "optionType"
        FROM projection_threads
        WHERE thread_id = 'fork-thread'
      `;
      const postRepairHyprnav = yield* sql<{ readonly hyprnav: string }>`
        SELECT hyprnav_json AS hyprnav
        FROM projection_projects
        WHERE project_id = 'post-repair-project'
      `;
      const repairedIndexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name IN (
            'idx_projection_projects_workspace_root_deleted_at',
            'idx_projection_threads_project_deleted_created',
            'idx_projection_threads_project_archived_at',
            'idx_projection_thread_activities_thread_sequence_created_id',
            'idx_projection_thread_messages_thread_created_id',
            'idx_projection_threads_shell_active',
            'idx_projection_threads_shell_archived'
          )
      `;

      assert.equal(sessionColumns.has("scopes"), true);
      assert.equal(sessionColumns.has("role"), false);
      assert.equal(projectColumns.has("hyprnav_json"), true);
      assert.equal(projectColumns.has("worktree_group_titles_json"), true);
      assert.equal(threadColumns.has("fork_source_thread_id"), true);
      assert.equal(threadColumns.has("model"), false);
      assert.deepEqual(latestTurn, [{ latestTurnId: "fork-turn" }]);
      assert.deepEqual(modelOptions, [{ optionType: "array" }]);
      assert.deepEqual(postRepairHyprnav, [{ hyprnav: "null" }]);
      assert.equal(repairedIndexes.length, 7);
      yield* sql`
        CREATE TRIGGER reject_compatibility_event_rescan
        BEFORE UPDATE ON orchestration_events
        BEGIN
          SELECT RAISE(FAIL, 'compatibility event rescan');
        END
      `;
      assert.deepEqual(yield* runMigrations(), []);
    }),
  );
});

const v2HistoricalNames = [
  "ProjectionThreadsForkOrigin",
  "ProjectionProjectsHyprnavSettings",
  "NormalizeProjectHyprnavScopes",
  "RestoreInheritedProjectHyprnavNulls",
  "RepairProviderInstanceIdProjectionColumns",
  "RepairProjectionThreadLatestTurnIds",
  "ProviderSessionRuntimeIndexes",
  "RepairForkMigrationCompatibility",
];

const requiredColumns = [
  ["auth_sessions", ["client_surface", "client_app_version"]],
  [
    "projection_projects",
    ["auto_pull", "project_icon_json", "hyprnav_json", "worktree_group_titles_json"],
  ],
  [
    "projection_threads",
    [
      "linked_pull_request_json",
      "unsettled_at",
      "fork_source_thread_id",
      "branch_pull_request_json",
      "active_order_key",
      "title_state_json",
    ],
  ],
  ["projection_thread_messages", ["context_json"]],
  ["projection_thread_sessions", ["provider_instance_id"]],
] as const;

const assertCurrentSchema = Effect.fn("assertCurrentSchema")(function* (sql: SqlClient.SqlClient) {
  for (const [table, required] of requiredColumns) {
    const columns = names(
      yield* sql<{ readonly name: string }>`PRAGMA table_info(${sql.literal(table)})`,
    );
    for (const column of required) assert.equal(columns.has(column), true, `${table}.${column}`);
  }
  const tables = names(
    yield* sql<{ readonly name: string }>`SELECT name FROM sqlite_master WHERE type = 'table'`,
  );
  assert.equal(tables.has("projection_thread_pull_requests"), true);
  assert.equal(tables.has("pull_request_files_viewed"), true);
  assert.deepEqual(yield* sql`PRAGMA quick_check`.values, [["ok"]]);
});

const readLedger = (sql: SqlClient.SqlClient) =>
  sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;

for (const source of ["canonical", "fork"] as const) {
  it.effect(`upgrades the ${source} ledger without losing either schema or rewriting history`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: source === "canonical" ? 47 : 40 });
      if (source === "fork") {
        yield* forkSchemaBaseline;
        for (const [offset, name] of v2HistoricalNames.entries()) {
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${41 + offset}, ${name})`;
        }
      }
      const before = yield* readLedger(sql);
      const executed = yield* runMigrations();
      assert.deepEqual(
        executed.map(([id]) => id),
        source === "canonical" ? [48, 49, 50, 51, 52, 53] : [49, 50, 51, 52, 53],
      );
      assert.deepEqual((yield* readLedger(sql)).slice(0, before.length), before);
      assert.deepEqual(
        yield* forkLedger(sql),
        source === "canonical"
          ? [
              ["fork", 1],
              ["fork", 2],
              ["fork", 3],
            ]
          : [
              ...[41, 42, 43, 44, 45, 46, 47, 48].map((key) => ["canonical-replay", key] as const),
              ["fork", 1],
              ["fork", 2],
              ["fork", 3],
            ],
      );
      yield* assertCurrentSchema(sql);
      assert.deepEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
}

// Ledger of the maintainer's live fork database (September 2026 snapshot).
const liveForkLedgerNames = [
  "ProjectionThreadsForkOrigin",
  "ProjectionThreadsForkOriginCompat",
  "ProjectionProjectsWorktreeGroupTitles",
  "ProjectionProjectsWorktreeGroupTitles",
  "RepairForkedMigrationDrift",
  "ProjectionThreadsForkOriginCompatBackfill",
  "ProjectionThreadsArchivedAtCompatBackfill",
  "ProjectionThreadShellSummary",
  "BackfillProjectionThreadShellSummary",
  "CleanupInvalidProjectionPendingApprovals",
  "ProjectionProjectsWorktreeGroupTitles",
  "RepairForkedMigrationDrift",
  "RepairMissingAuthAccessTables",
  "RepairProjectionThreadLatestTurnIds",
  "ProjectionProjectsHyprnavSettings",
  "NormalizeProjectHyprnavScopes",
  "RestoreInheritedProjectHyprnavNulls",
  "NormalizeProjectHyprnavScopes",
  "RestoreInheritedProjectHyprnavNulls",
  "RepairProviderInstanceIdProjectionColumns",
  "RepairProjectionThreadLatestTurnIds",
  "ProviderSessionRuntimeIndexes",
  "RepairProjectionThreadLatestTurnIds",
  "ProviderSessionRuntimeIndexes",
  "RepairForkMigrationCompatibility",
  "RepairForkMigrationCompatibility",
  "ProjectionProjectsHyprnavSettings",
  "NormalizeProjectHyprnavScopes",
  "RestoreInheritedProjectHyprnavNulls",
  "RepairProviderInstanceIdProjectionColumns",
  "RepairProjectionThreadLatestTurnIds",
  "ProviderSessionRuntimeIndexes",
  "RepairForkMigrationCompatibility",
  "RepairForkMigrationCompatibilityV2",
] as const;

const defaultHyprnavJson = JSON.stringify(DEFAULT_PROJECT_HYPRNAV_SETTINGS);
// A saved override without the Corkdiff binding; normalization would append it.
const customHyprnavJson = JSON.stringify({
  bindings: [DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings[0]],
});

/**
 * Builds a database whose schema already carries canonical 1–47 plus the fork
 * baseline (what the fork's V2 repair produced), then replaces ledger rows
 * 16–49 with `ledgerNames` (undefined leaves the canonical row, null deletes it).
 */
const seedForkV2Database = Effect.fn("seedForkV2Database")(function* (
  sql: SqlClient.SqlClient,
  ledgerNames: ReadonlyArray<string | null | undefined>,
) {
  yield* runMigrations({ toMigrationInclusive: 47 });
  yield* forkSchemaBaseline;
  for (const [offset, name] of ledgerNames.entries()) {
    const migrationId = 16 + offset;
    if (name === undefined) continue;
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${migrationId}`;
    if (name === null) continue;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name, created_at)
      VALUES (${migrationId}, ${name}, '2026-08-21 13:55:03')
    `;
  }
  for (const [projectId, hyprnav] of [
    ["inherited-project", "null"],
    ["explicit-default-project", defaultHyprnavJson],
    ["custom-project", customHyprnavJson],
  ] as const) {
    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, default_model_selection_json,
        scripts_json, hyprnav_json, created_at, updated_at, deleted_at
      ) VALUES (
        ${projectId}, ${projectId}, ${`/tmp/${projectId}`}, NULL,
        '[]', ${hyprnav}, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL
      )
    `;
  }
});

const readHyprnav = (sql: SqlClient.SqlClient) =>
  sql<{ readonly projectId: string; readonly hyprnav: string }>`
    SELECT project_id AS "projectId", hyprnav_json AS hyprnav
    FROM projection_projects
    ORDER BY project_id
  `;

it.effect("upgrades the live fork ledger (fork rows at 16–22 and 26–49)", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* seedForkV2Database(
      sql,
      liveForkLedgerNames.map((name, offset) => {
        const canonical = [23, 24, 25].includes(16 + offset);
        return canonical ? undefined : name;
      }),
    );
    const before = yield* readLedger(sql);
    const hyprnavBefore = yield* readHyprnav(sql);
    assert.equal(before.length, 49);

    const executed = yield* runMigrations();

    assert.deepEqual(
      executed.map(([id]) => id),
      [50, 51, 52, 53],
    );
    const ledger = yield* readLedger(sql);
    assert.deepEqual(ledger.slice(0, 49), before);
    assert.deepEqual(
      (yield* sql<{ readonly name: string }>`
        SELECT name FROM effect_sql_migrations WHERE migration_id BETWEEN 16 AND 49
        ORDER BY migration_id
      `).map((row) => row.name),
      [...liveForkLedgerNames],
    );
    assert.deepEqual(yield* forkLedger(sql), [
      ...[16, 17, 18, 19, 20, 21, 22]
        .concat(Array.from({ length: 24 }, (_, index) => 26 + index))
        .map((key) => ["canonical-replay", key] as const),
      ["fork", 1],
      ["fork", 2],
      ["fork", 3],
    ]);
    assert.deepEqual(yield* readHyprnav(sql), hyprnavBefore);
    yield* assertCurrentSchema(sql);

    yield* sql`
      CREATE TRIGGER reject_second_run_event_rescan
      BEFORE UPDATE ON orchestration_events
      BEGIN
        SELECT RAISE(FAIL, 'second run rescanned events');
      END
    `;
    assert.deepEqual(yield* runMigrations(), []);
    assert.deepEqual(yield* readLedger(sql), ledger);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("upgrades a fork-main database (canonical 1–47 plus V2 at 49)", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* seedForkV2Database(sql, [
      ...Array.from({ length: 32 }, () => undefined),
      null,
      "RepairForkMigrationCompatibilityV2",
    ]);
    const before = yield* readLedger(sql);
    const hyprnavBefore = yield* readHyprnav(sql);
    assert.equal(before.length, 48);

    const executed = yield* runMigrations();

    assert.deepEqual(
      executed.map(([id]) => id),
      [50, 51, 52, 53],
    );
    const ledger = yield* readLedger(sql);
    assert.deepEqual(ledger.slice(0, 48), before);
    assert.deepEqual(yield* forkLedger(sql), [
      ["canonical-replay", 48],
      ["canonical-replay", 49],
      ["fork", 1],
      ["fork", 2],
      ["fork", 3],
    ]);
    // The V2 row proves the baseline ran, so saved Hyprnav overrides stay as written.
    assert.deepEqual(yield* readHyprnav(sql), hyprnavBefore);
    assert.deepEqual(
      hyprnavBefore.map((row) => row.hyprnav),
      [customHyprnavJson, defaultHyprnavJson, "null"],
    );
    yield* assertCurrentSchema(sql);
    assert.deepEqual(yield* runMigrations(), []);
    assert.deepEqual(yield* readLedger(sql), ledger);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);

for (const upstreamMigrationId of [47, 53] as const) {
  it.effect(`adds fork schema to an upstream database at ${upstreamMigrationId}`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: upstreamMigrationId });
      const projectColumns = names(
        yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`,
      );
      assert.equal(projectColumns.has("hyprnav_json"), false);
      const before = yield* readLedger(sql);

      const executed = yield* runMigrations();

      assert.deepEqual(
        executed.map(([id]) => id),
        upstreamMigrationId === 47 ? [48, 49, 50, 51, 52, 53] : [],
      );
      assert.deepEqual((yield* readLedger(sql)).slice(0, before.length), before);
      assert.deepEqual(yield* forkLedger(sql), [
        ["fork", 1],
        ["fork", 2],
        ["fork", 3],
      ]);
      yield* assertCurrentSchema(sql);
      assert.deepEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
  );
}

it.effect("refuses to skip a canonical migration above 49 claimed by a fork row", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 49 });
    yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (50, 'ForkClaim')`;

    const error = yield* Effect.flip(runMigrations());

    assert.instanceOf(error, Migrator.MigrationError);
    assert.equal(error.kind, "BadState");
    assert.include(error.message, "50_ProjectionThreadPullRequests");
    const threadColumns = names(
      yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`,
    );
    assert.equal(threadColumns.has("title_state_json"), false);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);

const readCleanupCursor = (sql: SqlClient.SqlClient) =>
  sql<{ readonly sequence: number }>`
    SELECT last_applied_sequence AS sequence FROM projection_state
    WHERE projector = 'projection.attachment-cleanup'
  `.pipe(Effect.map((rows) => rows.map((row) => row.sequence)));

it.effect("starts the attachment cleanup cursor at the lowest existing projector watermark", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 53 });
    yield* sql`
      INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES
        ('projection.projects', 120, '2026-09-01T00:00:00.000Z'),
        ('projection.threads', 90, '2026-09-02T00:00:00.000Z'),
        ('repair.projection-threads.latest-turn-preservation.v1', 5, '2026-07-01T00:00:00.000Z')
    `;

    yield* runMigrations();

    assert.deepEqual(yield* readCleanupCursor(sql), [90]);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("keeps an existing attachment cleanup cursor and leaves fresh databases to replay", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 53 });
    yield* sql`
      INSERT INTO projection_state (projector, last_applied_sequence, updated_at) VALUES
        ('projection.projects', 120, '2026-09-01T00:00:00.000Z'),
        ('projection.attachment-cleanup', 10, '2026-08-01T00:00:00.000Z')
    `;

    yield* runMigrations();
    assert.deepEqual(yield* readCleanupCursor(sql), [10]);

    const fresh = yield* Effect.gen(function* () {
      yield* runMigrations();
      return yield* readCleanupCursor(yield* SqlClient.SqlClient);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" })));
    assert.deepEqual(fresh, []);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:" }))),
);
