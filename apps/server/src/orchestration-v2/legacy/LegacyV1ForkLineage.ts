import { ThreadId, type OrchestrationV2AppThreadLineage } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Fork builds before 0.1.0 stored thread fork origins in
 * `projection_threads.fork_source_thread_id`. The v1 importer turns them into
 * v2 fork lineage so old forks keep their parent. Origins whose source thread
 * no longer exists import as root threads.
 */
export const readLegacyForkLineage = Effect.fn("readLegacyForkLineage")(function* (
  sql: SqlClient.SqlClient,
) {
  const rows = yield* sql<{ readonly threadId: string; readonly parentThreadId: string }>`
    SELECT thread.thread_id AS "threadId", thread.fork_source_thread_id AS "parentThreadId"
    FROM projection_threads AS thread
    INNER JOIN projection_threads AS parent
      ON parent.thread_id = thread.fork_source_thread_id
    WHERE thread.fork_source_thread_id IS NOT NULL
      AND thread.fork_source_thread_id <> thread.thread_id
  `;
  const parents = new Map(rows.map((row) => [row.threadId, row.parentThreadId]));

  const rootOf = (threadId: string) => {
    const visited = new Set([threadId]);
    let current = threadId;
    for (let parent = parents.get(current); parent !== undefined; parent = parents.get(current)) {
      // A cycle has no root; stop at the last thread before it repeats.
      if (visited.has(parent)) break;
      visited.add(parent);
      current = parent;
    }
    return current;
  };

  return (threadId: string): OrchestrationV2AppThreadLineage => {
    const parentThreadId = parents.get(threadId);
    return parentThreadId === undefined
      ? { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(threadId) }
      : {
          parentThreadId: ThreadId.make(parentThreadId),
          relationshipToParent: "fork",
          rootThreadId: ThreadId.make(rootOf(threadId)),
        };
  };
});
