import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import * as EventSink from "../EventSink.ts";
import * as EventStore from "../EventStore.ts";
import * as LegacyV1ThreadImporter from "./LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../ProjectionStore.ts";

const layerDatabase = SqlitePersistence.layerMemory;
const layerStores = Layer.mergeAll(
  layerDatabase,
  EventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ProjectionStore.layer.pipe(Layer.provideMerge(layerDatabase)),
);
const layerEventSink = EventSink.layer.pipe(Layer.provide(layerStores));
const layerTest = Layer.mergeAll(
  layerStores,
  layerEventSink,
  LegacyV1ThreadImporter.layer.pipe(Layer.provide(Layer.mergeAll(layerStores, layerEventSink))),
);

const insertThread = (sql: SqlClient.SqlClient, threadId: string, forkSource: string | null) =>
  sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
      branch, worktree_path, latest_turn_id, created_at, updated_at, deleted_at,
      fork_source_thread_id, forked_at
    ) VALUES (
      ${threadId}, 'project:fork-lineage', ${threadId},
      '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', 'default',
      NULL, NULL, NULL, '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', NULL,
      ${forkSource}, ${forkSource === null ? null : "2026-03-01T00:00:00.000Z"}
    )
  `;

it.layer(layerTest)("legacy fork lineage", (it) => {
  it.effect("imports fork build thread origins as v2 fork lineage", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const importer = yield* LegacyV1ThreadImporter.LegacyV1ThreadImporter;
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project:fork-lineage', 'Fork lineage', '/tmp/fork-lineage', NULL, '[]',
          '2026-03-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', NULL
        )
      `;
      yield* insertThread(sql, "thread:root", null);
      yield* insertThread(sql, "thread:child", "thread:root");
      yield* insertThread(sql, "thread:grandchild", "thread:child");
      yield* insertThread(sql, "thread:orphan", "thread:deleted-long-ago");

      yield* importer.reconcileShells;

      const lineageOf = (threadId: string) =>
        projections
          .getThreadProjection(ThreadId.make(threadId))
          .pipe(Effect.map((projection) => projection.thread.lineage));
      assert.deepEqual(yield* lineageOf("thread:root"), {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: ThreadId.make("thread:root"),
      });
      assert.deepEqual(yield* lineageOf("thread:child"), {
        parentThreadId: ThreadId.make("thread:root"),
        relationshipToParent: "fork",
        rootThreadId: ThreadId.make("thread:root"),
      });
      assert.deepEqual(yield* lineageOf("thread:grandchild"), {
        parentThreadId: ThreadId.make("thread:child"),
        relationshipToParent: "fork",
        rootThreadId: ThreadId.make("thread:root"),
      });
      assert.deepEqual(yield* lineageOf("thread:orphan"), {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: ThreadId.make("thread:orphan"),
      });
    }),
  );
});
