import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type Project,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as WorktreeHandlers from "./handlers.ts";
import { WorktreeToolkit } from "./tools.ts";

const projectId = ProjectId.make("project:mcp-test");
const workspaceRoot = "/work/repo";
const at = (second: number) => DateTime.makeUnsafe(Date.UTC(2026, 0, 1, 0, 0, second));

const shell = (
  id: string,
  overrides: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  ...liveThreadShell(ThreadId.make(id)),
  ...overrides,
});

const caller = shell("caller", { updatedAt: at(1) });
const threads = [
  caller,
  shell("sibling-new", { updatedAt: at(3) }),
  shell("sibling-old", { updatedAt: at(2) }),
  shell("archived", { updatedAt: at(4), archivedAt: at(5) }),
  shell("other-worktree", { updatedAt: at(6), worktreePath: "/work/repo-wt" }),
  shell("deleted", { deletedAt: at(7) }),
];

const scope = (
  threadId: string,
  capabilities: McpInvocationContext.McpInvocationScope["capabilities"] = new Set([
    "orchestration",
  ]),
): McpInvocationContext.McpInvocationScope => ({
  environmentId: EnvironmentId.make("environment:mcp-test"),
  requestNamespace: "provider-session",
  thread: {
    threadId: ThreadId.make(threadId),
    providerSessionId: "provider-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities,
  issuedAt: 0,
});

/** Calls one worktree tool as `threadId` against the fixture threads and returns its result. */
const call = (
  name: "get_current_thread" | "list_worktree_threads",
  params: Record<string, unknown>,
  invocation: McpInvocationContext.McpInvocationScope,
) =>
  Effect.gen(function* () {
    const dependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, invocation),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed(threads.find((entry) => entry.id === threadId) ?? null),
        listProjectThreads: () => Effect.succeed(threads),
      }),
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeed(Option.some({ id: projectId, workspaceRoot } as Project)),
      }),
    );
    const toolkit = yield* WorktreeToolkit.pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(WorktreeHandlers.layer).pipe(Layer.provide(dependencies)),
      ),
    );
    const results = yield* toolkit
      .handle(name, params as never)
      .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
    return results.at(-1)?.result as Record<string, unknown>;
  });

it.effect("describes the caller's thread and the directory it works in", () =>
  Effect.gen(function* () {
    expect(yield* call("get_current_thread", {}, scope("caller"))).toMatchObject({
      threadId: "caller",
      projectId,
      workspaceRoot,
      worktreePath: null,
      effectiveWorkingDirectory: workspaceRoot,
    });
    expect(yield* call("get_current_thread", {}, scope("other-worktree"))).toMatchObject({
      threadId: "other-worktree",
      effectiveWorkingDirectory: "/work/repo-wt",
    });
  }),
);

it.effect("reports a deleted or unknown caller thread as not found", () =>
  Effect.gen(function* () {
    for (const threadId of ["deleted", "missing"]) {
      expect(yield* call("get_current_thread", {}, scope(threadId))).toMatchObject({
        code: "thread_not_found",
      });
    }
  }),
);

it.effect("pages the threads sharing the caller's directory, newest first", () =>
  Effect.gen(function* () {
    const first = yield* call("list_worktree_threads", { limit: 2 }, scope("caller"));
    expect(first).toMatchObject({
      currentThreadId: "caller",
      effectiveWorkingDirectory: workspaceRoot,
    });
    const firstThreads = first.threads as ReadonlyArray<Record<string, unknown>>;
    expect(firstThreads.map((thread) => thread.threadId)).toEqual(["sibling-new", "sibling-old"]);
    expect(firstThreads.every((thread) => thread.isCurrent === false)).toBe(true);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = yield* call(
      "list_worktree_threads",
      { limit: 2, cursor: first.nextCursor },
      scope("caller"),
    );
    expect(
      (second.threads as ReadonlyArray<Record<string, unknown>>).map((thread) => [
        thread.threadId,
        thread.isCurrent,
      ]),
    ).toEqual([["caller", true]]);
    expect(second.nextCursor).toBeNull();

    const archived = yield* call(
      "list_worktree_threads",
      { includeArchived: true },
      scope("caller"),
    );
    expect(
      (archived.threads as ReadonlyArray<Record<string, unknown>>).map((thread) => thread.threadId),
    ).toContain("archived");
    // A cursor from one listing is refused by another.
    expect(
      yield* call(
        "list_worktree_threads",
        { includeArchived: true, cursor: first.nextCursor },
        scope("caller"),
      ),
    ).toMatchObject({ code: "invalid_request" });
  }),
);

it.effect("needs the orchestration capability to list threads", () =>
  Effect.gen(function* () {
    expect(yield* call("list_worktree_threads", {}, scope("caller", new Set()))).toMatchObject({
      code: "capability_denied",
    });
  }),
);
