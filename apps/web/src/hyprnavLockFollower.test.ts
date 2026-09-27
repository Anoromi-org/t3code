import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type DesktopHyprnavAgent,
  EnvironmentId,
  type HyprnavLockedEvent,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  consumeFollowedThread,
  decideHyprnavFollow,
  type HyprnavFollowInput,
  hyprnavThreadEnvIdsInEvent,
  markFollowedThread,
} from "./hyprnavLockFollower";

const PRIMARY = EnvironmentId.make("env-primary");
const WORKTREE_ENV = "p.0123456789ab.w.abcdef012345";
const threadEnv = (threadId: string) => `${WORKTREE_ENV}.t.${threadId}`;
const ref = (threadId: string, environmentId = PRIMARY) =>
  scopeThreadRef(environmentId, ThreadId.make(threadId));

const lockedEvent = (overrides: Partial<HyprnavLockedEvent> = {}): HyprnavLockedEvent => ({
  event: "locked",
  ts_ms: 1,
  seq: 5,
  locked_environment_id: threadEnv("thread-b"),
  previous_environment_id: threadEnv("thread-a"),
  cause: "workspace_goto",
  origin: null,
  environment: null,
  ...overrides,
});

const agent = (overrides: Partial<DesktopHyprnavAgent>): DesktopHyprnavAgent => ({
  agent_id: "agent-1",
  label: "Claude",
  client: "cua",
  pid: 1,
  environment_id: "/home/me/repo",
  slot_index: 1000,
  workspace_id: 1001,
  state: "working",
  last_beat_ms: 1,
  action_count: 0,
  last_action: null,
  current_target: null,
  attached_windows: [],
  created_at_ms: 1,
  thread_id: "thread-c",
  thread_environment_id: "env-other",
  ...overrides,
});

const decide = (overrides: Partial<HyprnavFollowInput> = {}) =>
  decideHyprnavFollow({
    event: lockedEvent(),
    baselineSeq: 1,
    currentRouteRef: ref("thread-a"),
    currentThreadEnvId: threadEnv("thread-a"),
    primaryEnvironmentId: PRIMARY,
    readThreadShell: () => ({ archivedAt: null }),
    agents: [],
    ...overrides,
  });

describe("decideHyprnavFollow", () => {
  it("treats the first lock after (re)connect as a baseline", () => {
    expect(decide({ baselineSeq: null })).toEqual({ kind: "ignore", reason: "baseline" });
  });

  it("ignores events at or before the baseline seq", () => {
    expect(decide({ baselineSeq: 5 })).toEqual({ kind: "ignore", reason: "stale" });
  });

  it("ignores connect snapshots", () => {
    expect(decide({ event: lockedEvent({ cause: "snapshot" }) })).toEqual({
      kind: "ignore",
      reason: "snapshot",
    });
  });

  it("ignores locks T3 itself made", () => {
    expect(decide({ event: lockedEvent({ origin: "t3code" }) })).toEqual({
      kind: "ignore",
      reason: "own-origin",
    });
  });

  it("never navigates on unlock", () => {
    expect(decide({ event: lockedEvent({ locked_environment_id: null }) })).toEqual({
      kind: "ignore",
      reason: "unlocked",
    });
  });

  it("navigates to a locked thread env in the primary environment", () => {
    expect(decide()).toEqual({ kind: "navigate", ref: ref("thread-b") });
  });

  it("follows locks from other origins such as the shell", () => {
    expect(decide({ event: lockedEvent({ origin: "hyprnav-shell" }) })).toEqual({
      kind: "navigate",
      ref: ref("thread-b"),
    });
  });

  it("does nothing when the locked thread is already on screen", () => {
    expect(decide({ currentRouteRef: ref("thread-b") })).toEqual({
      kind: "ignore",
      reason: "current",
    });
  });

  it("ignores a thread T3 does not know (deleted or stale env)", () => {
    expect(decide({ readThreadShell: () => null })).toEqual({
      kind: "ignore",
      reason: "unknown-thread",
    });
  });

  it("ignores an archived thread", () => {
    expect(decide({ readThreadShell: () => ({ archivedAt: "2026-09-27T00:00:00.000Z" }) })).toEqual(
      { kind: "ignore", reason: "archived" },
    );
  });

  it("ignores a thread env without a primary environment", () => {
    expect(decide({ primaryEnvironmentId: null })).toEqual({
      kind: "ignore",
      reason: "no-primary-environment",
    });
  });

  it("stays put when the worktree env of the thread on screen is locked", () => {
    expect(decide({ event: lockedEvent({ locked_environment_id: WORKTREE_ENV }) })).toEqual({
      kind: "ignore",
      reason: "ancestor-of-current",
    });
    expect(decide({ event: lockedEvent({ locked_environment_id: "p.0123456789ab" }) })).toEqual({
      kind: "ignore",
      reason: "ancestor-of-current",
    });
  });

  it("ignores a worktree env that is not an ancestor of the thread on screen", () => {
    expect(
      decide({
        event: lockedEvent({ locked_environment_id: "p.0123456789ab.w.999999999999" }),
      }),
    ).toEqual({ kind: "ignore", reason: "not-a-thread" });
    expect(
      decide({
        event: lockedEvent({ locked_environment_id: WORKTREE_ENV }),
        currentThreadEnvId: null,
      }),
    ).toEqual({ kind: "ignore", reason: "not-a-thread" });
  });

  it("follows a lock on a live agent's env to the agent's thread", () => {
    expect(
      decide({
        event: lockedEvent({ locked_environment_id: "/home/me/repo" }),
        agents: [agent({})],
      }),
    ).toEqual({ kind: "navigate", ref: ref("thread-c", EnvironmentId.make("env-other")) });
  });

  it("ignores other envs without a live agent that names a thread", () => {
    const event = lockedEvent({ locked_environment_id: "/home/me/repo" });
    for (const agents of [
      null,
      [],
      [agent({ state: "finished" })],
      [agent({ thread_id: null })],
      [agent({ thread_environment_id: null })],
      [agent({ environment_id: "/elsewhere" })],
    ]) {
      expect(decide({ event, agents })).toEqual({ kind: "ignore", reason: "not-a-thread" });
    }
  });
});

describe("hyprnavThreadEnvIdsInEvent", () => {
  it("collects thread envs from the new and the previous lock", () => {
    expect(hyprnavThreadEnvIdsInEvent(lockedEvent())).toEqual([
      ["thread-b", threadEnv("thread-b")],
      ["thread-a", threadEnv("thread-a")],
    ]);
    expect(
      hyprnavThreadEnvIdsInEvent(
        lockedEvent({ locked_environment_id: WORKTREE_ENV, previous_environment_id: null }),
      ),
    ).toEqual([]);
  });
});

describe("followed thread mark", () => {
  it("vouches only for the followed thread, briefly", () => {
    markFollowedThread(ref("thread-b"), 1_000);
    expect(consumeFollowedThread(ref("thread-b"), 1_001)).toBe(true);
    expect(consumeFollowedThread(ref("thread-b"), 1_002)).toBe(true);
    expect(consumeFollowedThread(ref("thread-b"), 7_000)).toBe(false);
  });

  it("is cleared by publishing another thread", () => {
    markFollowedThread(ref("thread-b"), 1_000);
    expect(consumeFollowedThread(ref("thread-a"), 1_001)).toBe(false);
    expect(consumeFollowedThread(ref("thread-b"), 1_002)).toBe(false);
  });
});
