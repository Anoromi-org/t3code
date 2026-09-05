import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { McpThreadContextQuery, layer } from "./McpThreadContextQuery.ts";

const testLayer = it.layer(
  layer.pipe(Layer.provideMerge(SqlitePersistenceMemory), Layer.provideMerge(NodeServices.layer)),
);

testLayer("McpThreadContextQuery", (it) => {
  it.effect("reads current context and paginates active threads on the same worktree", () =>
    Effect.gen(function* () {
      const query = yield* McpThreadContextQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json, scripts_json,
          created_at, updated_at, deleted_at
        ) VALUES (
          'project-1', 'Project', '/repo', '{"provider":"codex","model":"gpt-5"}', '[]',
          '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          branch, worktree_path, latest_turn_id, latest_user_message_at,
          pending_approval_count, pending_user_input_count, has_actionable_proposed_plan,
          created_at, updated_at, archived_at, deleted_at
        ) VALUES
          (
            'thread-current', 'project-1', 'Current', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', 'feature', '/repo-feature', 'turn-current', NULL, 0, 0, 0,
            '2026-08-01T00:00:01.000Z', '2026-08-01T00:00:05.000Z', NULL, NULL
          ),
          (
            'thread-same', 'project-1', 'Same worktree', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', 'feature', '/repo-feature', NULL, NULL, 0, 0, 0,
            '2026-08-01T00:00:02.000Z', '2026-08-01T00:00:04.000Z', NULL, NULL
          ),
          (
            'thread-archived', 'project-1', 'Archived', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', 'feature', '/repo-feature', NULL, NULL, 0, 0, 0,
            '2026-08-01T00:00:03.000Z', '2026-08-01T00:00:03.000Z',
            '2026-08-01T00:00:06.000Z', NULL
          ),
          (
            'thread-main', 'project-1', 'Main checkout', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', NULL, NULL, NULL, NULL, 0, 0, 0,
            '2026-08-01T00:00:04.000Z', '2026-08-01T00:00:07.000Z', NULL, NULL
          ),
          (
            'thread-main-peer', 'project-1', 'Main checkout peer',
            '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', NULL, NULL, NULL, NULL, 0, 0, 0,
            '2026-08-01T00:00:04.000Z', '2026-08-01T00:00:06.000Z', NULL, NULL
          ),
          (
            'thread-other', 'project-1', 'Other worktree', '{"provider":"codex","model":"gpt-5"}',
            'full-access', 'default', 'other', '/repo-other', NULL, NULL, 0, 0, 0,
            '2026-08-01T00:00:05.000Z', '2026-08-01T00:00:08.000Z', NULL, NULL
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id, status, provider_name, provider_session_id, provider_thread_id,
          runtime_mode, active_turn_id, last_error, updated_at
        ) VALUES (
          'thread-current', 'running', 'codex', 'session-current', 'provider-thread-current',
          'full-access', 'turn-current', NULL, '2026-08-01T00:00:05.000Z'
        )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, source_proposed_plan_thread_id,
          source_proposed_plan_id, assistant_message_id, state, requested_at, started_at,
          completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
          checkpoint_files_json
        ) VALUES (
          'thread-current', 'turn-current', NULL, NULL, NULL, NULL, 'running',
          '2026-08-01T00:00:05.000Z', '2026-08-01T00:00:05.000Z', NULL,
          NULL, NULL, NULL, '[]'
        )
      `;

      const current = yield* query.getCurrentThread(ThreadId.make("thread-current"));
      assert(Option.isSome(current));
      assert.equal(current.value.effectiveWorkingDirectory, "/repo-feature");
      assert.equal(current.value.threadId, "thread-current");
      assert.equal(current.value.sessionStatus, "running");
      assert.equal(current.value.latestTurnState, "running");

      const first = yield* query.listWorktreeThreads({
        threadId: ThreadId.make("thread-current"),
        limit: 1,
        includeArchived: false,
      });
      assert(Option.isSome(first));
      assert.deepEqual(
        first.value.threads.map((thread) => thread.threadId),
        ["thread-current"],
      );
      assert.equal(first.value.threads[0]?.isCurrent, true);
      assert.notEqual(first.value.nextCursor, null);

      const second = yield* query.listWorktreeThreads({
        threadId: ThreadId.make("thread-current"),
        ...(first.value.nextCursor === null ? {} : { cursor: first.value.nextCursor }),
        limit: 1,
        includeArchived: false,
      });
      assert(Option.isSome(second));
      assert.deepEqual(
        second.value.threads.map((thread) => thread.threadId),
        ["thread-same"],
      );
      assert.equal(second.value.nextCursor, null);

      const changedFilter = yield* query.listWorktreeThreads({
        threadId: ThreadId.make("thread-current"),
        ...(first.value.nextCursor === null ? {} : { cursor: first.value.nextCursor }),
        limit: 1,
        includeArchived: true,
      });
      assert(Option.isSome(changedFilter));
      assert.deepEqual(
        changedFilter.value.threads.map((thread) => thread.threadId),
        ["thread-current"],
      );

      const withArchived = yield* query.listWorktreeThreads({
        threadId: ThreadId.make("thread-current"),
        limit: 20,
        includeArchived: true,
      });
      assert(Option.isSome(withArchived));
      assert.deepEqual(
        withArchived.value.threads.map((thread) => thread.threadId),
        ["thread-current", "thread-same", "thread-archived"],
      );

      const mainCheckout = yield* query.listWorktreeThreads({
        threadId: ThreadId.make("thread-main"),
        limit: 20,
        includeArchived: false,
      });
      assert(Option.isSome(mainCheckout));
      assert.equal(mainCheckout.value.effectiveWorkingDirectory, "/repo");
      assert.deepEqual(
        mainCheckout.value.threads.map((thread) => thread.threadId),
        ["thread-main", "thread-main-peer"],
      );
    }),
  );

  it.effect("returns none when the credential's thread no longer exists", () =>
    Effect.gen(function* () {
      const query = yield* McpThreadContextQuery;
      const result = yield* query.listWorktreeThreads({
        threadId: ThreadId.make("missing"),
        limit: 20,
        includeArchived: false,
      });
      assert(Option.isNone(result));
    }),
  );
});
