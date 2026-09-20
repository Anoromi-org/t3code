import type { DesktopHyprnavAgent } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldShowDesktopAgentMiniPlayer } from "./shouldShowDesktopAgentMiniPlayer";

function agent(overrides: Partial<DesktopHyprnavAgent> = {}): DesktopHyprnavAgent {
  return {
    agent_id: "agent-1",
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
    current_target: "0xdeadbeef",
    attached_windows: [],
    created_at_ms: 0,
    thread_id: "thread-A",
    thread_environment_id: "env-1",
    ...overrides,
  };
}

describe("shouldShowDesktopAgentMiniPlayer", () => {
  it("shows a working agent bound to a thread", () => {
    expect(shouldShowDesktopAgentMiniPlayer(agent())).toBe(true);
  });

  it("shows an agent that needs the user", () => {
    expect(shouldShowDesktopAgentMiniPlayer(agent({ state: "waiting_for_user" }))).toBe(true);
  });

  it("stays away once the agent is finished or idle", () => {
    expect(shouldShowDesktopAgentMiniPlayer(agent({ state: "finished" }))).toBe(false);
    expect(shouldShowDesktopAgentMiniPlayer(agent({ state: "idle" }))).toBe(false);
  });

  it("stays away without a window to show", () => {
    expect(shouldShowDesktopAgentMiniPlayer(agent({ current_target: null }))).toBe(false);
  });

  it("stays away when the daemon reports no thread (older hyprnav, or a foreign agent)", () => {
    expect(shouldShowDesktopAgentMiniPlayer(agent({ thread_id: null }))).toBe(false);
    expect(shouldShowDesktopAgentMiniPlayer(agent({ thread_environment_id: null }))).toBe(false);
    const { thread_id: _omitted, ...withoutThreadId } = agent();
    expect(shouldShowDesktopAgentMiniPlayer(withoutThreadId)).toBe(false);
  });
});
