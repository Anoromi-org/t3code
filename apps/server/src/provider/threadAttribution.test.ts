import { assert, it } from "@effect/vitest";

import { threadAttributionEnvironment } from "./threadAttribution.ts";

it("layers thread attribution over the provider environment", () => {
  assert.deepEqual(
    {
      PATH: "/bin",
      ...threadAttributionEnvironment({ threadId: "thread-1", environmentId: "environment-1" }),
    },
    { PATH: "/bin", T3CODE_THREAD_ID: "thread-1", T3CODE_ENVIRONMENT_ID: "environment-1" },
  );
  // Without an MCP session there is no environment to name.
  assert.deepEqual(
    { PATH: "/bin", ...threadAttributionEnvironment({ threadId: "thread-1" }) },
    { PATH: "/bin", T3CODE_THREAD_ID: "thread-1" },
  );
});
