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

import { retryOnSqliteBusySnapshot, runMigrations } from "../Migrations.ts";
import * as SqliteClient from "../NodeSqliteClient.ts";
import { ensureProjectionThreadForkOriginColumns } from "./041_ProjectionThreadsForkOrigin.ts";
import { ensureProjectionProjectHyprnavColumns } from "./042_ProjectionProjectsHyprnavSettings.ts";
import { normalizeProjectionProjectHyprnavRows } from "./043_NormalizeProjectHyprnavScopes.ts";
import { restoreInheritedProjectHyprnavNulls } from "./044_RestoreInheritedProjectHyprnavNulls.ts";
import { ensureProviderInstanceIdProjectionColumns } from "./045_RepairProviderInstanceIdProjectionColumns.ts";
import { ensureProviderSessionRuntimeIndexes } from "./047_ProviderSessionRuntimeIndexes.ts";
import { repairProjectionThreadLatestTurnIds } from "../Repairs/ProjectionThreadLatestTurnIds.ts";

const freshDatabase = it.layer(SqliteClient.layerMemory());
const forkDatabase = it.layer(SqliteClient.layerMemory());
const partialForkDatabase = it.layer(SqliteClient.layerMemory());
const authlessForkDatabase = it.layer(SqliteClient.layerMemory());
const cutoff23ForkDatabase = it.layer(SqliteClient.layerMemory());
const pre29ForkDatabase = it.layer(SqliteClient.layerMemory());
const previousRebuildDatabase = it.layer(SqliteClient.layerMemory());
const repaired42Database = it.layer(SqliteClient.layerMemory());
const boundedForwardDatabase = it.layer(SqliteClient.layerMemory());

const names = (rows: ReadonlyArray<{ readonly name: string }>) =>
  new Set(rows.map((row) => row.name));
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
        assert.equal(ledger.at(-1)?.migrationId, 48);
        assert.isTrue(ledger.every((row) => row.count === 1));

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

freshDatabase("048_RepairForkMigrationCompatibility fresh database", (it) => {
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
        { migrationId: 41, name: "ProjectionThreadsForkOrigin" },
        { migrationId: 42, name: "ProjectionProjectsHyprnavSettings" },
        { migrationId: 43, name: "NormalizeProjectHyprnavScopes" },
        { migrationId: 44, name: "RestoreInheritedProjectHyprnavNulls" },
        { migrationId: 45, name: "RepairProviderInstanceIdProjectionColumns" },
        { migrationId: 46, name: "RepairProjectionThreadLatestTurnIds" },
        { migrationId: 47, name: "ProviderSessionRuntimeIndexes" },
        { migrationId: 48, name: "RepairForkMigrationCompatibility" },
      ]);

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

previousRebuildDatabase("048_RepairForkMigrationCompatibility previous rebuild", (it) => {
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
      assert.deepEqual(executed.at(-1), [48, "RepairForkMigrationCompatibility"]);

      const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        WHERE migration_id BETWEEN 34 AND 48
        ORDER BY migration_id
      `;
      assert.deepEqual(
        ledger.slice(0, 8).map((row) => row.name),
        historicalNames,
      );
      assert.deepEqual(ledger.at(-1), {
        migrationId: 48,
        name: "RepairForkMigrationCompatibility",
      });

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

repaired42Database("048_RepairForkMigrationCompatibility former repair 42", (it) => {
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
          [43, "NormalizeProjectHyprnavScopes"],
          [44, "RestoreInheritedProjectHyprnavNulls"],
          [45, "RepairProviderInstanceIdProjectionColumns"],
          [46, "RepairProjectionThreadLatestTurnIds"],
          [47, "ProviderSessionRuntimeIndexes"],
          [48, "RepairForkMigrationCompatibility"],
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

boundedForwardDatabase("048_RepairForkMigrationCompatibility bounded forward repair", (it) => {
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

partialForkDatabase("048_RepairForkMigrationCompatibility partial fork database", (it) => {
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
        WHERE migration_id IN (16, 17, 48)
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
        { migrationId: 48, name: "RepairForkMigrationCompatibility" },
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

authlessForkDatabase("048_RepairForkMigrationCompatibility authless fork database", (it) => {
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

      yield* runMigrations({ toMigrationInclusive: 48 });

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
        { migrationId: 48, name: "RepairForkMigrationCompatibility" },
      ]);
      assert.equal(pairingColumns.has("scopes"), true);
      assert.equal(pairingColumns.has("proof_key_thumbprint"), true);
      assert.equal(sessionColumns.has("scopes"), true);
    }),
  );
});

cutoff23ForkDatabase("048_RepairForkMigrationCompatibility migration-23 fork database", (it) => {
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

pre29ForkDatabase("048_RepairForkMigrationCompatibility pre-29 fork database", (it) => {
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

forkDatabase("048_RepairForkMigrationCompatibility fork database", (it) => {
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
          [41, "ProjectionThreadsForkOrigin"],
          [42, "ProjectionProjectsHyprnavSettings"],
          [43, "NormalizeProjectHyprnavScopes"],
          [44, "RestoreInheritedProjectHyprnavNulls"],
          [45, "RepairProviderInstanceIdProjectionColumns"],
          [46, "RepairProjectionThreadLatestTurnIds"],
          [47, "ProviderSessionRuntimeIndexes"],
          [48, "RepairForkMigrationCompatibility"],
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
