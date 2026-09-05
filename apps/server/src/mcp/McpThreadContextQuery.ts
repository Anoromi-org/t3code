import {
  IsoDateTime,
  McpCurrentThread,
  type McpListWorktreeThreadsResult,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../persistence/Errors.ts";

const ThreadIdLookupInput = Schema.Struct({ threadId: ThreadId });
const WorktreeThreadPageRequest = Schema.Struct({
  currentThreadId: ThreadId,
  beforeUpdatedAt: Schema.String,
  beforeThreadId: Schema.String,
  includeArchived: Schema.Number,
  limit: Schema.Int,
});
const WorktreeThreadRow = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  branch: Schema.NullOr(Schema.String),
  sessionStatus: Schema.NullOr(
    Schema.Literals(["idle", "starting", "running", "ready", "interrupted", "stopped", "error"]),
  ),
  latestTurnState: Schema.NullOr(Schema.Literals(["running", "interrupted", "completed", "error"])),
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
const WorktreeThreadPageCursor = Schema.Struct({
  t: ThreadId,
  u: IsoDateTime,
  i: ThreadId,
  a: Schema.Boolean,
});
const decodeWorktreeThreadPageCursor = Schema.decodeUnknownOption(WorktreeThreadPageCursor);

interface ListWorktreeThreadsInput {
  readonly threadId: ThreadId;
  readonly cursor?: string;
  readonly limit: number;
  readonly includeArchived: boolean;
}

interface WorktreeThreadCursor {
  readonly currentThreadId: ThreadId;
  readonly beforeUpdatedAt: string;
  readonly beforeThreadId: ThreadId;
  readonly includeArchived: boolean;
}

export interface McpThreadContextQueryShape {
  readonly getCurrentThread: (
    threadId: ThreadId,
  ) => Effect.Effect<Option.Option<McpCurrentThread>, ProjectionRepositoryError>;
  readonly listWorktreeThreads: (
    input: ListWorktreeThreadsInput,
  ) => Effect.Effect<Option.Option<McpListWorktreeThreadsResult>, ProjectionRepositoryError>;
}

export class McpThreadContextQuery extends Context.Service<
  McpThreadContextQuery,
  McpThreadContextQueryShape
>()("t3/mcp/McpThreadContextQuery") {}

function encodeCursor(cursor: WorktreeThreadCursor): string {
  return Buffer.from(
    JSON.stringify({
      t: cursor.currentThreadId,
      u: cursor.beforeUpdatedAt,
      i: cursor.beforeThreadId,
      a: cursor.includeArchived,
    }),
  ).toString("base64url");
}

function decodeCursor(encoded: string): WorktreeThreadCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const decoded = decodeWorktreeThreadPageCursor(parsed);
  return Option.isSome(decoded)
    ? {
        currentThreadId: decoded.value.t,
        beforeUpdatedAt: decoded.value.u,
        beforeThreadId: decoded.value.i,
        includeArchived: decoded.value.a,
      }
    : null;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const getCurrentThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: McpCurrentThread,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          threads.title,
          threads.branch,
          projects.workspace_root AS "workspaceRoot",
          threads.worktree_path AS "worktreePath",
          COALESCE(threads.worktree_path, projects.workspace_root) AS "effectiveWorkingDirectory",
          sessions.status AS "sessionStatus",
          turns.state AS "latestTurnState",
          threads.created_at AS "createdAt",
          threads.updated_at AS "updatedAt"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        LEFT JOIN projection_thread_sessions AS sessions
          ON sessions.thread_id = threads.thread_id
        LEFT JOIN projection_turns AS turns
          ON turns.thread_id = threads.thread_id
          AND turns.turn_id = threads.latest_turn_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
          AND projects.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const listWorktreeThreadRows = SqlSchema.findAll({
    Request: WorktreeThreadPageRequest,
    Result: WorktreeThreadRow,
    execute: ({ currentThreadId, beforeUpdatedAt, beforeThreadId, includeArchived, limit }) =>
      sql`
        WITH current_context AS (
          SELECT
            threads.project_id AS project_id,
            COALESCE(threads.worktree_path, projects.workspace_root) AS effective_worktree_path
          FROM projection_threads AS threads
          INNER JOIN projection_projects AS projects
            ON projects.project_id = threads.project_id
          WHERE threads.thread_id = ${currentThreadId}
            AND threads.deleted_at IS NULL
            AND projects.deleted_at IS NULL
          LIMIT 1
        )
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          threads.title,
          threads.branch,
          sessions.status AS "sessionStatus",
          turns.state AS "latestTurnState",
          threads.archived_at AS "archivedAt",
          threads.created_at AS "createdAt",
          threads.updated_at AS "updatedAt"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        INNER JOIN current_context AS current
          ON current.project_id = threads.project_id
          AND current.effective_worktree_path = COALESCE(threads.worktree_path, projects.workspace_root)
        LEFT JOIN projection_thread_sessions AS sessions
          ON sessions.thread_id = threads.thread_id
        LEFT JOIN projection_turns AS turns
          ON turns.thread_id = threads.thread_id
          AND turns.turn_id = threads.latest_turn_id
        WHERE threads.deleted_at IS NULL
          AND (${includeArchived} = 1 OR threads.archived_at IS NULL)
          AND (
            ${beforeUpdatedAt} = '~'
            OR threads.updated_at < ${beforeUpdatedAt}
            OR (threads.updated_at = ${beforeUpdatedAt} AND threads.thread_id < ${beforeThreadId})
          )
        ORDER BY threads.updated_at DESC, threads.thread_id DESC
        LIMIT ${limit}
      `,
  });

  const getCurrentThread: McpThreadContextQueryShape["getCurrentThread"] = (threadId) =>
    getCurrentThreadRow({ threadId }).pipe(
      Effect.mapError((error) =>
        isPersistenceError(error)
          ? error
          : toPersistenceSqlError("McpThreadContextQuery.getCurrentThread")(error),
      ),
    );

  const listWorktreeThreads: McpThreadContextQueryShape["listWorktreeThreads"] = Effect.fn(
    "McpThreadContextQuery.listWorktreeThreads",
  )(function* (input) {
    const decodedCursor = input.cursor ? decodeCursor(input.cursor) : null;
    const cursor =
      decodedCursor?.currentThreadId === input.threadId &&
      decodedCursor.includeArchived === input.includeArchived
        ? decodedCursor
        : null;
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const currentThread = yield* getCurrentThread(input.threadId);
          if (Option.isNone(currentThread)) return Option.none();

          const rows = yield* listWorktreeThreadRows({
            currentThreadId: input.threadId,
            beforeUpdatedAt: cursor?.beforeUpdatedAt ?? "~",
            beforeThreadId: cursor?.beforeThreadId ?? "",
            includeArchived: input.includeArchived ? 1 : 0,
            limit: input.limit + 1,
          });
          const hasMore = rows.length > input.limit;
          const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
          const last = pageRows.at(-1);
          return Option.some({
            currentThreadId: input.threadId,
            effectiveWorkingDirectory: currentThread.value.effectiveWorkingDirectory,
            threads: pageRows.map((row) => ({
              ...row,
              isCurrent: row.threadId === input.threadId,
            })),
            nextCursor:
              hasMore && last
                ? encodeCursor({
                    currentThreadId: input.threadId,
                    beforeUpdatedAt: last.updatedAt,
                    beforeThreadId: last.threadId,
                    includeArchived: input.includeArchived,
                  })
                : null,
          });
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          isPersistenceError(error)
            ? error
            : toPersistenceSqlError("McpThreadContextQuery.listWorktreeThreads")(error),
        ),
      );
  });

  return McpThreadContextQuery.of({ getCurrentThread, listWorktreeThreads });
});

export const layer = Layer.effect(McpThreadContextQuery, make);
