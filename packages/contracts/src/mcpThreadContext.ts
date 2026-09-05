import * as Schema from "effect/Schema";

import { IsoDateTime, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { OrchestrationSessionStatus } from "./orchestration.ts";

export const McpThreadContextErrorReason = Schema.Literals([
  "capability-unavailable",
  "current-thread-not-found",
  "read-failed",
]);
export type McpThreadContextErrorReason = typeof McpThreadContextErrorReason.Type;

export class McpThreadContextError extends Schema.TaggedErrorClass<McpThreadContextError>()(
  "McpThreadContextError",
  {
    reason: McpThreadContextErrorReason,
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "capability-unavailable":
        return "The MCP credential does not grant thread context access.";
      case "current-thread-not-found":
        return "The current T3 Code thread is no longer available.";
      case "read-failed":
        return "T3 Code could not read thread context.";
    }
  }
}

export const McpCurrentThread = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  workspaceRoot: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  effectiveWorkingDirectory: TrimmedNonEmptyString,
  sessionStatus: Schema.NullOr(OrchestrationSessionStatus),
  latestTurnState: Schema.NullOr(Schema.Literals(["running", "interrupted", "completed", "error"])),
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
  title: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  sessionStatus: Schema.NullOr(OrchestrationSessionStatus),
  latestTurnState: Schema.NullOr(Schema.Literals(["running", "interrupted", "completed", "error"])),
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
