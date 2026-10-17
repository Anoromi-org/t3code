import { assert, it } from "@effect/vitest";
import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { decodeCursor, encodeCursor, threadsSharingDirectory } from "./threadContext.ts";

const shell = (
  id: string,
  updatedAt: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell =>
  ({
    id,
    worktreePath: null,
    archivedAt: null,
    deletedAt: null,
    updatedAt: DateTime.makeUnsafe(updatedAt),
    ...overrides,
  }) as OrchestrationV2ThreadShell;

it("lists threads in the same directory, newest first", () => {
  const threads = [
    shell("root-old", "2026-07-01T00:00:00.000Z"),
    shell("root-new", "2026-07-03T00:00:00.000Z"),
    shell("worktree", "2026-07-02T00:00:00.000Z", { worktreePath: "/repo-wt" }),
    shell("archived", "2026-07-04T00:00:00.000Z", {
      archivedAt: DateTime.makeUnsafe("2026-07-04T00:00:00.000Z"),
    }),
  ];
  const ids = (includeArchived: boolean, effectiveWorkingDirectory: string) =>
    threadsSharingDirectory(threads, {
      workspaceRoot: "/repo",
      effectiveWorkingDirectory,
      includeArchived,
    }).map((thread) => thread.id);

  assert.deepEqual(ids(false, "/repo"), ["root-new", "root-old"]);
  assert.deepEqual(ids(true, "/repo"), ["archived", "root-new", "root-old"]);
  assert.deepEqual(ids(false, "/repo-wt"), ["worktree"]);
});

it("binds cursors to the thread and archive filter", () => {
  const cursor = encodeCursor("thread-1", false, 20);
  assert.equal(decodeCursor(cursor, "thread-1", false), 20);
  assert.isNull(decodeCursor(cursor, "thread-2", false));
  assert.isNull(decodeCursor(cursor, "thread-1", true));
  assert.isNull(decodeCursor("not-a-cursor", "thread-1", false));
});
