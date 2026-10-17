// Opt-in checks against a copy of a real database. Never point these at a live
// install: T3CODE_MIGRATION_COMPAT_DB is migrated in place.
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqliteClient from "@t3tools/shared/nodeSqliteClient";

import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as EventStore from "../../orchestration-v2/EventStore.ts";
import * as LegacyV1ThreadImporter from "../../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { initializeV2Database } from "../initializeV2Database.ts";
import { migrationManifest, runMigrations } from "../Migrations.ts";
import * as SqlitePersistence from "../Sqlite.ts";

const databasePath = process.env.T3CODE_MIGRATION_COMPAT_DB;
const latestMigration = migrationManifest.at(-1)!;

const countRows = (sql: SqlClient.SqlClient) =>
  Effect.all({
    messages: sql`SELECT COUNT(*) AS count FROM projection_thread_messages`,
    threads: sql`SELECT COUNT(*) AS count FROM projection_threads`,
    projects: sql`
      SELECT project_id, hyprnav_json, worktree_group_titles_json
      FROM projection_projects ORDER BY project_id
    `,
    forkOrigins: sql`
      SELECT thread_id, fork_source_thread_id FROM projection_threads
      WHERE fork_source_thread_id IS NOT NULL ORDER BY thread_id
    `,
  });

it.effect.skipIf(!databasePath)(
  "migrates an explicitly supplied real database copy",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ledgerBefore = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      const countsBefore = yield* countRows(sql);
      yield* runMigrations();

      const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
        SELECT migration_id AS "migrationId", name
        FROM effect_sql_migrations
        ORDER BY migration_id
      `;
      assert.deepEqual(ledger.at(-1), {
        migrationId: latestMigration[0],
        name: latestMigration[1],
      });
      assert.deepEqual(
        (yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`).slice(
          0,
          ledgerBefore.length,
        ),
        ledgerBefore,
      );
      const forkLedger = yield* sql<{ readonly key: number }>`
        SELECT key FROM t3code_fork_migrations WHERE kind = 'fork' ORDER BY key
      `;
      assert.deepEqual(
        forkLedger.map((row) => row.key),
        [1, 2, 3],
      );
      // Fork-only data survives the canonical V2 chain untouched.
      assert.deepEqual(yield* countRows(sql), countsBefore);

      const columnsOf = (table: string) =>
        sql<{ readonly name: string }>`PRAGMA table_info(${sql.literal(table)})`.pipe(
          Effect.map((rows) => new Set(rows.map((row) => row.name))),
        );
      const projectNames = yield* columnsOf("projection_projects");
      const threadNames = yield* columnsOf("projection_threads");
      const sessionNames = yield* columnsOf("auth_sessions");
      assert.equal(sessionNames.has("scopes"), true);
      assert.equal(sessionNames.has("role"), false);
      assert.equal(projectNames.has("hyprnav_json"), true);
      assert.equal(projectNames.has("worktree_group_titles_json"), true);
      assert.equal(threadNames.has("fork_source_thread_id"), true);
      assert.equal(threadNames.has("auto_settle_disabled_at"), true);

      assert.deepEqual(yield* sql`PRAGMA integrity_check`.values, [["ok"]]);
      assert.deepEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: databasePath! }))),
  { timeout: 600_000 },
);

const sourceSnapshotPath = process.env.T3CODE_REBASE_SNAPSHOT;
it.effect.skipIf(!sourceSnapshotPath)(
  "imports a copy of real fork state into V2 without touching the legacy file",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-rebase-real-state-" });
      const legacyPath = path.join(directory, "state.sqlite");
      const v2Path = path.join(directory, "statev2.sqlite");
      yield* fs.copyFile(sourceSnapshotPath!, legacyPath);
      const legacyBefore = yield* fs.stat(legacyPath);
      yield* initializeV2Database(v2Path);

      const layerDatabase = SqlitePersistence.layerFromPath(v2Path);
      const layerStores = Layer.mergeAll(
        layerDatabase,
        EventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
        ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase)),
      );
      const layerEventSink = EventSink.layer.pipe(Layer.provide(layerStores));
      const layerImporter = Layer.mergeAll(
        layerStores,
        LegacyV1ThreadImporter.layer.pipe(
          Layer.provide(Layer.mergeAll(layerStores, layerEventSink)),
        ),
      );

      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const liveThreads = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM projection_threads WHERE deleted_at IS NULL
        `;
        const forkOrigins = yield* sql<{ readonly threadId: string; readonly parent: string }>`
          SELECT thread.thread_id AS "threadId", thread.fork_source_thread_id AS parent
          FROM projection_threads AS thread
          INNER JOIN projection_threads AS source ON source.thread_id = thread.fork_source_thread_id
          WHERE thread.deleted_at IS NULL
        `;

        const first = yield* importer.reconcileShells;
        yield* importer.importPendingTranscripts;
        assert.isAbove(first.importedThreadCount, 0);
        assert.deepEqual(yield* importer.reconcileShells, {
          importedThreadCount: 0,
          importedMessageCount: 0,
        });
        assert.equal(yield* importer.pendingThreadCount, 0);

        const shells = yield* projections.getShellSnapshot();
        assert.isAtLeast(shells.threads.length, liveThreads[0]?.count ?? 0);
        for (const origin of forkOrigins) {
          const shell = shells.threads.find((thread) => thread.id === origin.threadId);
          assert.equal(shell?.lineage.parentThreadId, origin.parent, origin.threadId);
          assert.equal(shell?.lineage.relationshipToParent, "fork", origin.threadId);
        }
        assert.deepEqual(yield* sql`PRAGMA quick_check`.values, [["ok"]]);
      }).pipe(Effect.provide(layerImporter));

      const legacyAfter = yield* fs.stat(legacyPath);
      assert.deepEqual(
        [legacyAfter.size, legacyAfter.mtime],
        [legacyBefore.size, legacyBefore.mtime],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { timeout: 600_000 },
);
