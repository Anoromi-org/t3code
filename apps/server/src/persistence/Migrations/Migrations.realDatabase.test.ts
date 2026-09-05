import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerConfig } from "../../config.ts";
import { OrchestrationProjectionPipelineLive } from "../../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "../../orchestration/Services/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEventStoreLive } from "../Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive } from "../Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import * as ThreadBackgroundLiveness from "../../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../../orchestration/ThreadPlanProgress.ts";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as SqliteClient from "@t3tools/shared/nodeSqliteClient";

const databasePath = process.env.T3CODE_MIGRATION_COMPAT_DB;

it.effect("migrates an explicitly supplied real database copy", () => {
  if (!databasePath) return Effect.void;

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();

    const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
      SELECT migration_id AS "migrationId", name
      FROM effect_sql_migrations
      ORDER BY migration_id
    `;
    assert.equal(ledger.at(-1)?.migrationId, 49);
    assert.equal(ledger.at(-1)?.name, "RepairForkMigrationCompatibilityV2");

    const pairingColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(auth_pairing_links)
    `;
    const sessionColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
    const projectColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_projects)
    `;
    const threadColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_threads)
    `;
    const pairingNames = new Set(pairingColumns.map((column) => column.name));
    const sessionNames = new Set(sessionColumns.map((column) => column.name));
    const projectNames = new Set(projectColumns.map((column) => column.name));
    const threadNames = new Set(threadColumns.map((column) => column.name));

    assert.equal(pairingNames.has("scopes"), true);
    assert.equal(pairingNames.has("proof_key_thumbprint"), true);
    assert.equal(pairingNames.has("role"), false);
    assert.equal(sessionNames.has("scopes"), true);
    assert.equal(sessionNames.has("role"), false);
    assert.equal(projectNames.has("hyprnav_json"), true);
    assert.equal(projectNames.has("worktree_group_titles_json"), true);
    assert.equal(projectNames.has("default_model"), false);
    assert.equal(threadNames.has("fork_source_thread_id"), true);
    assert.equal(threadNames.has("snoozed_until"), true);
    assert.equal(threadNames.has("snoozed_at"), true);
    assert.equal(threadNames.has("model"), false);

    const requiredIndexes = [
      "idx_projection_projects_workspace_root_deleted_at",
      "idx_projection_threads_project_deleted_created",
      "idx_projection_threads_project_archived_at",
      "idx_projection_thread_activities_thread_sequence_created_id",
      "idx_projection_thread_messages_thread_created_id",
      "idx_projection_threads_shell_active",
      "idx_projection_threads_shell_archived",
    ];
    const indexes = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'index'
    `;
    const indexNames = new Set(indexes.map((index) => index.name));
    assert.equal(
      requiredIndexes.every((index) => indexNames.has(index)),
      true,
    );

    const quickCheck = yield* sql`PRAGMA quick_check`.values;
    assert.deepEqual(quickCheck, [["ok"]]);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: databasePath })));
});

const sourceSnapshotPath = process.env.T3CODE_REBASE_SNAPSHOT;
it.effect.skipIf(!sourceSnapshotPath)(
  "bootstraps a fresh copy of real fork state without losing history",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-rebase-real-state-" });
      const filename = path.join(directory, "state.sqlite");
      yield* fs.copyFile(sourceSnapshotPath!, filename);
      const stateLayer = Layer.mergeAll(
        OrchestrationProjectionPipelineLive,
        OrchestrationProjectionSnapshotQueryLive.pipe(
          Layer.provide(ThreadBackgroundLiveness.layer),
          Layer.provide(ThreadPlanProgress.layer),
        ),
      ).pipe(
        Layer.provideMerge(OrchestrationEventStoreLive),
        Layer.provideMerge(RepositoryIdentityResolver.layer),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-rebase-startup-" })),
        Layer.provideMerge(makeSqlitePersistenceLive(filename)),
      );
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const pipeline = yield* OrchestrationProjectionPipeline;
        const query = yield* ProjectionSnapshotQuery;
        const before =
          yield* sql`SELECT COUNT(*) AS count, MAX(sequence) AS sequence FROM orchestration_events`;
        const messagesBefore = yield* sql`SELECT COUNT(*) AS count FROM projection_thread_messages`;
        yield* pipeline.bootstrap;
        const first = yield* query.getSnapshot();
        yield* pipeline.bootstrap;
        const second = yield* query.getSnapshot();
        assert.deepEqual(second, first);
        assert.deepEqual(
          yield* sql`SELECT COUNT(*) AS count, MAX(sequence) AS sequence FROM orchestration_events`,
          before,
        );
        assert.deepEqual(
          yield* sql`SELECT COUNT(*) AS count FROM projection_thread_messages`,
          messagesBefore,
        );
        assert.isAbove(first.threads.length, 0);
        assert.deepEqual(yield* sql`PRAGMA quick_check`.values, [["ok"]]);
      }).pipe(Effect.provide(stateLayer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
