import { assert, it } from "@effect/vitest";

import {
  codexThreadMcpAttributionConfig,
  withThreadAttributionEnvironment,
} from "./threadAttribution.ts";

it("layers thread attribution over the provider environment", () => {
  assert.deepEqual(
    withThreadAttributionEnvironment(
      { PATH: "/bin" },
      { threadId: "thread-1", environmentId: "environment-1" },
    ),
    { PATH: "/bin", T3CODE_THREAD_ID: "thread-1", T3CODE_ENVIRONMENT_ID: "environment-1" },
  );
  assert.deepEqual(withThreadAttributionEnvironment({ PATH: "/bin" }, { threadId: "thread-1" }), {
    PATH: "/bin",
    T3CODE_THREAD_ID: "thread-1",
  });
  assert.deepEqual(withThreadAttributionEnvironment({ PATH: "/bin" }, null), { PATH: "/bin" });
});

it("attributes only a plainly named Codex MCP server", () => {
  const attribution = { threadId: "thread-1", environmentId: "environment-1" };
  assert.deepEqual(codexThreadMcpAttributionConfig("learning", attribution), {
    "mcp_servers.learning.env.T3CODE_THREAD_ID": "thread-1",
    "mcp_servers.learning.env.T3CODE_ENVIRONMENT_ID": "environment-1",
  });
  assert.deepEqual(codexThreadMcpAttributionConfig(undefined, attribution), {});
  assert.deepEqual(codexThreadMcpAttributionConfig("bad.name", attribution), {});
  assert.deepEqual(codexThreadMcpAttributionConfig("learning", null), {});
});
