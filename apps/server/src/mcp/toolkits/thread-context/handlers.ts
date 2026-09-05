import { McpThreadContextError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { McpThreadContextQuery } from "../../McpThreadContextQuery.ts";
import { ThreadContextToolkit } from "./tools.ts";

const requireScope = Effect.fn("ThreadContextToolkit.requireScope")(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (!scope.capabilities.has("thread-context")) {
    return yield* new McpThreadContextError({ reason: "capability-unavailable" });
  }
  return scope;
});

const readFailed = () => new McpThreadContextError({ reason: "read-failed" });
const currentThreadNotFound = () =>
  new McpThreadContextError({ reason: "current-thread-not-found" });

export const ThreadContextToolkitHandlersLive = ThreadContextToolkit.toLayer({
  get_current_thread: () =>
    Effect.gen(function* () {
      const scope = yield* requireScope();
      const query = yield* McpThreadContextQuery;
      const result = yield* query
        .getCurrentThread(scope.threadId)
        .pipe(Effect.mapError(readFailed));
      if (Option.isNone(result)) {
        return yield* currentThreadNotFound();
      }
      return result.value;
    }),
  list_worktree_threads: (input) =>
    Effect.gen(function* () {
      const scope = yield* requireScope();
      const query = yield* McpThreadContextQuery;
      const result = yield* query
        .listWorktreeThreads({
          threadId: scope.threadId,
          limit: input.limit ?? 20,
          includeArchived: input.includeArchived ?? false,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        })
        .pipe(Effect.mapError(readFailed));
      if (Option.isNone(result)) {
        return yield* currentThreadNotFound();
      }
      return result.value;
    }),
});
