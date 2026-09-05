import {
  McpCurrentThread,
  McpListWorktreeThreadsInput,
  McpListWorktreeThreadsResult,
  McpThreadContextError,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { McpThreadContextQuery } from "../../McpThreadContextQuery.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, McpThreadContextQuery];

export const GetCurrentThreadTool = Tool.make("get_current_thread", {
  description:
    "Return the T3 Code thread that owns this provider session, including its project, branch, effective working directory, and current runtime state.",
  parameters: Schema.Record(Schema.String, Schema.Never),
  success: McpCurrentThread,
  failure: McpThreadContextError,
  dependencies,
})
  .annotate(Tool.Title, "Get current T3 Code thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ListWorktreeThreadsTool = Tool.make("list_worktree_threads", {
  description:
    "List T3 Code threads in the same project and effective working directory as this provider session. Results contain lightweight thread metadata, are ordered by most recently updated, and use cursor pagination.",
  parameters: McpListWorktreeThreadsInput,
  success: McpListWorktreeThreadsResult,
  failure: McpThreadContextError,
  dependencies,
})
  .annotate(Tool.Title, "List threads on current worktree")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ThreadContextToolkit = Toolkit.make(GetCurrentThreadTool, ListWorktreeThreadsTool);
