import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  selectThreadDesktopAgentMiniPlayer,
  useDesktopAgentMiniPlayerStore,
} from "./desktopAgentMiniPlayerStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => {
  useDesktopAgentMiniPlayerStore.setState({ byThreadKey: {}, dismissedByAgentId: {} });
});

describe("desktopAgentMiniPlayerStore", () => {
  it("keeps floating agent views scoped to their thread", () => {
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-a", "0x1");
    useDesktopAgentMiniPlayerStore.getState().open(refB, "agent-b", "0x2");

    expect(
      selectThreadDesktopAgentMiniPlayer(
        useDesktopAgentMiniPlayerStore.getState().byThreadKey,
        refA,
      ),
    ).toMatchObject({ agentId: "agent-a", address: "0x1" });
    expect(
      selectThreadDesktopAgentMiniPlayer(
        useDesktopAgentMiniPlayerStore.getState().byThreadKey,
        refB,
      ),
    ).toMatchObject({ agentId: "agent-b", address: "0x2" });
  });

  it("preserves position when the agent's window changes within one thread", () => {
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-a", "0x1");
    useDesktopAgentMiniPlayerStore.getState().move(refA, "agent-a", { x: 24, y: 48 });
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-a", "0x2");

    expect(
      selectThreadDesktopAgentMiniPlayer(
        useDesktopAgentMiniPlayerStore.getState().byThreadKey,
        refA,
      ),
    ).toEqual({
      agentId: "agent-a",
      address: "0x2",
      position: { x: 24, y: 48 },
      size: null,
    });
  });

  it("ignores stale drag updates after the agent changes", () => {
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-a", "0x1");
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-b", "0x2");
    useDesktopAgentMiniPlayerStore.getState().move(refA, "agent-a", { x: 100, y: 100 });

    expect(
      selectThreadDesktopAgentMiniPlayer(
        useDesktopAgentMiniPlayerStore.getState().byThreadKey,
        refA,
      ),
    ).toEqual({
      agentId: "agent-b",
      address: "0x2",
      position: null,
      size: null,
    });
  });

  it("preserves a thread-bound size while the agent changes", () => {
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-a", "0x1");
    useDesktopAgentMiniPlayerStore.getState().resize(refA, "agent-a", { width: 480, height: 320 });
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-b", "0x2");

    expect(
      selectThreadDesktopAgentMiniPlayer(
        useDesktopAgentMiniPlayerStore.getState().byThreadKey,
        refA,
      ),
    ).toMatchObject({ agentId: "agent-b", size: { width: 480, height: 320 } });
  });

  it("remembers which agent state the user dismissed, so a later one re-opens", () => {
    useDesktopAgentMiniPlayerStore.getState().open(refA, "agent-a", "0x1");
    useDesktopAgentMiniPlayerStore.getState().dismiss(refA, "agent-a", "working");

    expect(
      selectThreadDesktopAgentMiniPlayer(
        useDesktopAgentMiniPlayerStore.getState().byThreadKey,
        refA,
      ),
    ).toBeNull();
    expect(useDesktopAgentMiniPlayerStore.getState().dismissedByAgentId).toEqual({
      "agent-a": "working",
    });
  });
});
