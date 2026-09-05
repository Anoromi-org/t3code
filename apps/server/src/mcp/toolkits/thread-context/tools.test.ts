import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpSchema, McpServer, Tool } from "effect/unstable/ai";

import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { McpThreadContextQuery } from "../../McpThreadContextQuery.ts";
import { ThreadContextToolkit } from "./tools.ts";

const threadId = ThreadId.make("thread-current");
const currentThread = {
  threadId,
  projectId: ProjectId.make("project-1"),
  title: "Current thread",
  branch: "feature",
  workspaceRoot: "/repo",
  worktreePath: "/repo-feature",
  effectiveWorkingDirectory: "/repo-feature",
  sessionStatus: "running" as const,
  latestTurnState: "running" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:01.000Z",
};
const query = McpThreadContextQuery.of({
  getCurrentThread: () => Effect.succeed(Option.some(currentThread)),
  listWorktreeThreads: (input) =>
    Effect.succeed(
      Option.some({
        currentThreadId: input.threadId,
        effectiveWorkingDirectory: "/repo-feature",
        threads: [
          {
            threadId,
            projectId: ProjectId.make("project-1"),
            title: "Current thread",
            branch: "feature",
            sessionStatus: "running",
            latestTurnState: "running",
            archivedAt: null,
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-01T00:00:01.000Z",
            isCurrent: true,
          },
        ],
        nextCursor: null,
      }),
    ),
});
const invocation = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId,
  providerSessionId: "provider-session-1",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(["thread-context"] as const),
  issuedAt: 1,
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});
const testLayer = McpHttpServer.ThreadContextToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(Layer.succeed(McpThreadContextQuery, query)),
);

it("exports read-only provider-compatible schemas", () => {
  for (const tool of Object.values(ThreadContextToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as { readonly type?: unknown };
    expect(schema.type, `${tool.name} must export an object schema`).toBe("object");
    expect(tool.description?.length ?? 0).toBeGreaterThan(40);
    expect(Context.get(tool.annotations, Tool.Readonly)).toBe(true);
    expect(Context.get(tool.annotations, Tool.Destructive)).toBe(false);
  }
});

it.effect("returns context bound to the authenticated provider session", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const current = yield* server
      .callTool({ name: "get_current_thread", arguments: {} })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(current.isError).toBe(false);
    expect(current.structuredContent).toMatchObject({
      threadId,
      effectiveWorkingDirectory: "/repo-feature",
    });

    const list = yield* server
      .callTool({ name: "list_worktree_threads", arguments: {} })
      .pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        Effect.provideService(McpSchema.McpServerClient, client),
      );
    expect(list.isError).toBe(false);
    expect(list.structuredContent).toMatchObject({
      currentThreadId: threadId,
      threads: [{ threadId, isCurrent: true }],
    });
  }).pipe(Effect.provide(testLayer)),
);
