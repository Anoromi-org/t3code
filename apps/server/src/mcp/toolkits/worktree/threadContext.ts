import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * Fork: threads that work in the given directory, newest first. A thread
 * without a worktree works in its project root.
 */
export function threadsSharingDirectory(
  threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  input: {
    readonly workspaceRoot: string;
    readonly effectiveWorkingDirectory: string;
    readonly includeArchived: boolean;
  },
): OrchestrationV2ThreadShell[] {
  return threads
    .filter(
      (thread) =>
        thread.deletedAt === null &&
        (input.includeArchived || thread.archivedAt === null) &&
        (thread.worktreePath ?? input.workspaceRoot) === input.effectiveWorkingDirectory,
    )
    .toSorted(
      (left, right) =>
        DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt),
    );
}

// The cursor is the offset into the newest-first list, bound to the thread and
// archive filter so it cannot be replayed against a different listing.
export const encodeCursor = (threadId: string, includeArchived: boolean, offset: number) =>
  Buffer.from(JSON.stringify([threadId, includeArchived, offset])).toString("base64url");
export function decodeCursor(
  cursor: string,
  threadId: string,
  includeArchived: boolean,
): number | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value[0] !== threadId || value[1] !== includeArchived) return null;
    return typeof value[2] === "number" && Number.isInteger(value[2]) && value[2] >= 0
      ? value[2]
      : null;
  } catch {
    return null;
  }
}
