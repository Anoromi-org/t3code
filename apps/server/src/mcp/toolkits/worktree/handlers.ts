import {
  type McpWorktreeThread,
  OrchestratorMcpFailure,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as GitWorkflow from "../../../git/GitWorkflowService.ts";
import * as Project from "../../../project/ProjectService.ts";
import { readThread, unavailable } from "../../threadAccess.ts";
import * as Effect from "effect/Effect";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as WorktreeMcpService from "../../WorktreeMcpService.ts";
import { decodeCursor, encodeCursor, threadsSharingDirectory } from "./threadContext.ts";
import { WorktreeToolkit } from "./tools.ts";

const DEFAULT_WORKTREE_THREAD_LIMIT = 20;

/** Fork: the caller's thread and the directory it works in. */
const callerThreadContext = Effect.gen(function* () {
  const context = yield* McpInvocationContext.McpInvocationContext;
  const caller = context.thread;
  const threadNotFound = new OrchestratorMcpFailure({
    code: "thread_not_found",
    message: "The current T3 Code thread is no longer available.",
  });
  if (caller === undefined) return yield* threadNotFound;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const shell = yield* threads.getThreadShell(caller.threadId).pipe(Effect.mapError(unavailable));
  if (shell === null || shell.deletedAt !== null) return yield* threadNotFound;
  const projects = yield* Project.ProjectService;
  const project = yield* projects.getById(shell.projectId).pipe(Effect.mapError(unavailable));
  if (Option.isNone(project)) return yield* threadNotFound;
  const workspaceRoot = project.value.workspaceRoot;
  return {
    context,
    shell,
    workspaceRoot,
    effectiveWorkingDirectory: shell.worktreePath ?? workspaceRoot,
  };
});

function worktreeThread(
  shell: OrchestrationV2ThreadShell,
  currentThreadId: string,
): McpWorktreeThread {
  return {
    threadId: shell.id,
    projectId: shell.projectId,
    title: shell.title,
    branch: shell.branch,
    status: shell.status,
    archivedAt: shell.archivedAt === null ? null : DateTime.formatIso(shell.archivedAt),
    createdAt: DateTime.formatIso(shell.createdAt),
    updatedAt: DateTime.formatIso(shell.updatedAt),
    isCurrent: shell.id === currentThreadId,
  };
}

const handlers = {
  t3_worktree_list: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      const context = yield* McpInvocationContext.McpInvocationContext;
      if (!context.capabilities.has("worktree"))
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "This credential cannot inspect worktrees.",
        });
      const { threadId, ...refs } = input;
      const {
        projection: { thread },
      } = yield* readThread(threadId);
      const projects = yield* Project.ProjectService;
      const project = yield* projects.getById(thread.projectId).pipe(Effect.mapError(unavailable));
      if (Option.isNone(project))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The project was not found.",
        });
      const git = yield* GitWorkflow.GitWorkflowService;
      return yield* git
        .listRefs({ ...refs, cwd: thread.worktreePath ?? project.value.workspaceRoot })
        .pipe(Effect.mapError(unavailable));
    }),
  ),
  t3_worktree_handoff: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* WorktreeMcpService.WorktreeMcpService;
      return yield* service.handoff(scope, input);
    }),
  ),
  t3_worktree_status: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* WorktreeMcpService.WorktreeMcpService;
      return yield* service.status(scope);
    }),
  ),
  get_current_thread: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      const { shell, workspaceRoot, effectiveWorkingDirectory } = yield* callerThreadContext;
      return {
        threadId: shell.id,
        projectId: shell.projectId,
        title: shell.title,
        branch: shell.branch,
        workspaceRoot,
        worktreePath: shell.worktreePath,
        effectiveWorkingDirectory,
        status: shell.status,
        createdAt: DateTime.formatIso(shell.createdAt),
        updatedAt: DateTime.formatIso(shell.updatedAt),
      };
    }),
  ),
  list_worktree_threads: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { context, shell, workspaceRoot, effectiveWorkingDirectory } =
        yield* callerThreadContext;
      if (!context.capabilities.has("orchestration"))
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: "This credential cannot list threads.",
        });
      const includeArchived = input.includeArchived === true;
      const offset =
        input.cursor === undefined ? 0 : decodeCursor(input.cursor, shell.id, includeArchived);
      if (offset === null)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The cursor does not belong to this listing.",
        });
      const threads = yield* ThreadManagement.ThreadManagementService;
      const projectThreads = yield* threads
        .listProjectThreads({ projectId: shell.projectId, includeSubagents: false })
        .pipe(Effect.mapError(unavailable));
      const matching = threadsSharingDirectory(projectThreads, {
        workspaceRoot,
        effectiveWorkingDirectory,
        includeArchived,
      });
      const limit = input.limit ?? DEFAULT_WORKTREE_THREAD_LIMIT;
      const page = matching.slice(offset, offset + limit);
      const nextOffset = offset + page.length;
      return {
        currentThreadId: shell.id,
        effectiveWorkingDirectory,
        threads: page.map((thread) => worktreeThread(thread, shell.id)),
        nextCursor:
          nextOffset < matching.length ? encodeCursor(shell.id, includeArchived, nextOffset) : null,
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof WorktreeToolkit.tools>;

export const layer = McpToolAccess.toLayer(WorktreeToolkit, handlers);
