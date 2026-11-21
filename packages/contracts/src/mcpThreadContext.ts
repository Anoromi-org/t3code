import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { OrchestrationV2ShellThreadStatus } from "./orchestrationV2.ts";

/**
 * Fork: results of the `get_current_thread` and `list_worktree_threads` MCP
 * tools, which tell an agent which T3 Code thread it belongs to and which
 * threads share its working directory.
 */
export const McpCurrentThread = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  workspaceRoot: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  effectiveWorkingDirectory: TrimmedNonEmptyString,
  status: OrchestrationV2ShellThreadStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type McpCurrentThread = typeof McpCurrentThread.Type;

export const McpListWorktreeThreadsInput = Schema.Struct({
  cursor: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(2048)).annotate({
      description: "Opaque nextCursor returned by a previous call. Omit for the first page.",
    }),
  ),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })).annotate({
      description: "Maximum threads to return. Defaults to 20 and cannot exceed 50.",
    }),
  ),
  includeArchived: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: "Whether to include archived threads. Defaults to false.",
    }),
  ),
});
export type McpListWorktreeThreadsInput = typeof McpListWorktreeThreadsInput.Type;

export const McpWorktreeThread = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  status: OrchestrationV2ShellThreadStatus,
  archivedAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  isCurrent: Schema.Boolean,
});
export type McpWorktreeThread = typeof McpWorktreeThread.Type;

export const McpListWorktreeThreadsResult = Schema.Struct({
  currentThreadId: ThreadId,
  effectiveWorkingDirectory: TrimmedNonEmptyString,
  threads: Schema.Array(McpWorktreeThread),
  nextCursor: Schema.NullOr(Schema.String),
});
export type McpListWorktreeThreadsResult = typeof McpListWorktreeThreadsResult.Type;
