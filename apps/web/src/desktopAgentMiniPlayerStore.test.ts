import type { DesktopHyprnavAgent } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { resolveDesktopAgentMiniPlayerTargets } from "./components/desktop/shouldShowDesktopAgentMiniPlayer";
import {
  staleDesktopAgentDismissals,
  useDesktopAgentMiniPlayerStore,
} from "./desktopAgentMiniPlayerStore";

function agent(overrides: Partial<DesktopHyprnavAgent> = {}): DesktopHyprnavAgent {
  return {
    agent_id: "agent-a",
    label: "planner",
    client: "cua",
    pid: 4242,
    environment_id: "hyprnav-env",
    slot_index: 0,
    workspace_id: 104,
    state: "working",
    last_beat_ms: 0,
    action_count: 3,
    last_action: "click",
    current_target: "0x1",
    attached_windows: [],
    created_at_ms: 0,
    thread_id: "thread-A",
    thread_environment_id: "env-1",
    ...overrides,
  };
}

const targetAgentIds = (agents: ReadonlyArray<DesktopHyprnavAgent>) =>
  resolveDesktopAgentMiniPlayerTargets(
    agents,
    useDesktopAgentMiniPlayerStore.getState().dismissedByAgentId,
  ).map((target) => target.source.agentId);

beforeEach(() => {
  useDesktopAgentMiniPlayerStore.setState({ dismissedByAgentId: {} });
});

describe("desktopAgentMiniPlayerStore", () => {
  it("remembers which agent state the user dismissed, so a later one re-opens", () => {
    useDesktopAgentMiniPlayerStore.getState().dismiss("agent-a", "working");

    expect(useDesktopAgentMiniPlayerStore.getState().dismissedByAgentId).toEqual({
      "agent-a": "working",
    });
    expect(targetAgentIds([agent()])).toEqual([]);
    expect(targetAgentIds([agent({ state: "waiting_for_user" })])).toEqual(["agent-a"]);
  });

  it("only suppresses the agent that was dismissed", () => {
    useDesktopAgentMiniPlayerStore.getState().dismiss("agent-a", "working");

    expect(
      targetAgentIds([agent(), agent({ agent_id: "agent-b", thread_id: "thread-B" })]),
    ).toEqual(["agent-b"]);
  });
});

describe("staleDesktopAgentDismissals", () => {
  it("forgets a dismissal once the agent changes state or leaves", () => {
    const store = useDesktopAgentMiniPlayerStore.getState();
    store.dismiss("agent-a", "working");
    store.dismiss("agent-b", "working");
    store.dismiss("agent-c", "working");
    const agents = [agent(), agent({ agent_id: "agent-b", state: "waiting_for_user" })];

    const stale = staleDesktopAgentDismissals(
      agents,
      useDesktopAgentMiniPlayerStore.getState().dismissedByAgentId,
    );
    expect(stale).toEqual(["agent-b", "agent-c"]);
    useDesktopAgentMiniPlayerStore.getState().forget(stale);

    expect(useDesktopAgentMiniPlayerStore.getState().dismissedByAgentId).toEqual({
      "agent-a": "working",
    });
    // Back to working later: no longer suppressed.
    expect(targetAgentIds([agent({ agent_id: "agent-b", thread_id: "thread-B" })])).toEqual([
      "agent-b",
    ]);
  });
});

describe("resolveDesktopAgentMiniPlayerTargets", () => {
  it("floats one agent per thread, the first registered one", () => {
    const targets = resolveDesktopAgentMiniPlayerTargets(
      [agent(), agent({ agent_id: "agent-b", current_target: "0x2" })],
      {},
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      threadRef: { environmentId: "env-1", threadId: "thread-A" },
      source: { kind: "desktop-agent", agentId: "agent-a", address: "0x1" },
    });
  });
});
