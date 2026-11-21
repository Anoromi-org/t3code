import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  browserMiniPlayerSource,
  type PreviewMiniPlayerSource,
  previewMiniPlayerSourceKey,
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "./previewMiniPlayerStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const tabA = browserMiniPlayerSource("tab-a");
const tabB = browserMiniPlayerSource("tab-b");

beforeEach(() => {
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
});

describe("previewMiniPlayerStore", () => {
  it("ignores stale drag updates after the floating tab changes", () => {
    usePreviewMiniPlayerStore.getState().open(refA, tabA);
    usePreviewMiniPlayerStore.getState().open(refA, tabB);
    usePreviewMiniPlayerStore.getState().move(refA, "browser:tab-a", { x: 100, y: 100 });

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toEqual({
      source: tabB,
      position: null,
      width: null,
      lastInteraction: "drag",
    });
  });
});

describe("previewMiniPlayerStore desktop agents", () => {
  const agentWindow = (agentId: string, address: string): PreviewMiniPlayerSource => ({
    kind: "desktop-agent",
    agentId,
    address,
  });
  const floating = (ref: typeof refA) =>
    selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, ref);

  it("keeps floating agent views scoped to their thread", () => {
    usePreviewMiniPlayerStore.getState().open(refA, agentWindow("agent-a", "0x1"));
    usePreviewMiniPlayerStore.getState().open(refB, agentWindow("agent-b", "0x2"));

    expect(floating(refA)).toMatchObject({ source: agentWindow("agent-a", "0x1") });
    expect(floating(refB)).toMatchObject({ source: agentWindow("agent-b", "0x2") });
  });

  it("preserves position when the agent's window changes within one thread", () => {
    const first = agentWindow("agent-a", "0x1");
    usePreviewMiniPlayerStore.getState().open(refA, first);
    usePreviewMiniPlayerStore
      .getState()
      .move(refA, previewMiniPlayerSourceKey(first), { x: 24, y: 48 });
    usePreviewMiniPlayerStore.getState().open(refA, agentWindow("agent-a", "0x2"));

    expect(floating(refA)).toEqual({
      source: agentWindow("agent-a", "0x2"),
      position: { x: 24, y: 48 },
      width: null,
      lastInteraction: "drag",
    });
  });

  it("ignores stale drag updates after the agent changes", () => {
    const first = agentWindow("agent-a", "0x1");
    usePreviewMiniPlayerStore.getState().open(refA, first);
    usePreviewMiniPlayerStore.getState().open(refA, agentWindow("agent-b", "0x2"));
    usePreviewMiniPlayerStore
      .getState()
      .move(refA, previewMiniPlayerSourceKey(first), { x: 100, y: 100 });

    expect(floating(refA)).toEqual({
      source: agentWindow("agent-b", "0x2"),
      position: null,
      width: null,
      lastInteraction: "drag",
    });
  });

  it("preserves a thread-bound size while the agent changes", () => {
    const first = agentWindow("agent-a", "0x1");
    usePreviewMiniPlayerStore.getState().open(refA, first);
    usePreviewMiniPlayerStore.getState().resize(refA, previewMiniPlayerSourceKey(first), 480);
    usePreviewMiniPlayerStore.getState().open(refA, agentWindow("agent-b", "0x2"));

    expect(floating(refA)).toMatchObject({
      source: agentWindow("agent-b", "0x2"),
      width: 480,
    });
  });
});
