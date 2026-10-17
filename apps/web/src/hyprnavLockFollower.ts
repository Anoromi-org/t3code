/**
 * Maps hyprnav's `locked` events onto T3 threads. The component in
 * `components/HyprnavLockFollower.tsx` feeds events in and navigates; this file
 * holds the decision and the loop guard shared with the runtime orchestrator.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  parseHyprnavEnvironmentId,
  type DesktopHyprnavAgent,
  EnvironmentId,
  type HyprnavLockedEvent,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

/** The origin tag T3's own lock/batch calls carry (desktop `HyprnavEnvironment`). */
export const HYPRNAV_T3_ORIGIN = "t3code";

export type HyprnavFollowIgnoreReason =
  | "baseline"
  | "stale"
  | "snapshot"
  | "own-origin"
  | "unlocked"
  | "no-primary-environment"
  | "ancestor-of-current"
  | "not-a-thread"
  | "current"
  | "unknown-thread"
  | "archived";

export type HyprnavFollowDecision =
  | { readonly kind: "navigate"; readonly ref: ScopedThreadRef }
  | { readonly kind: "ignore"; readonly reason: HyprnavFollowIgnoreReason };

export interface HyprnavFollowInput {
  readonly event: HyprnavLockedEvent;
  /** Seq of the first lock seen since the stream (re)connected; `null` until then. */
  readonly baselineSeq: number | null;
  readonly currentRouteRef: ScopedThreadRef | null;
  /** The hyprnav env id of the thread on screen, when an event has revealed it. */
  readonly currentThreadEnvId: string | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly readThreadShell: (ref: ScopedThreadRef) => { readonly archivedAt: string | null } | null;
  readonly agents: ReadonlyArray<DesktopHyprnavAgent> | null;
}

const ignore = (reason: HyprnavFollowIgnoreReason): HyprnavFollowDecision => ({
  kind: "ignore",
  reason,
});

/** The thread a locked env stands for, or why there is none. */
function resolveLockedThread(
  locked: string,
  input: HyprnavFollowInput,
): ScopedThreadRef | HyprnavFollowIgnoreReason {
  const parsed = parseHyprnavEnvironmentId(locked);
  if (parsed?.scope === "thread") {
    // T3 only publishes threads of its primary environment.
    if (input.primaryEnvironmentId === null) return "no-primary-environment";
    return scopeThreadRef(input.primaryEnvironmentId, ThreadId.make(parsed.threadId));
  }
  if (parsed) {
    // A worktree or project env: the user went to e.g. the worktree terminal.
    return input.currentThreadEnvId?.startsWith(`${locked}.`)
      ? "ancestor-of-current"
      : "not-a-thread";
  }
  // Any other env: an agent's cwd env follows the thread the agent works for.
  const agent = input.agents?.find(
    (candidate) =>
      candidate.environment_id === locked &&
      candidate.state !== "finished" &&
      candidate.thread_id &&
      candidate.thread_environment_id,
  );
  if (!agent?.thread_id || !agent.thread_environment_id) return "not-a-thread";
  return scopeThreadRef(
    EnvironmentId.make(agent.thread_environment_id),
    ThreadId.make(agent.thread_id),
  );
}

export function decideHyprnavFollow(input: HyprnavFollowInput): HyprnavFollowDecision {
  const { event } = input;
  if (input.baselineSeq === null) return ignore("baseline");
  if (event.seq <= input.baselineSeq) return ignore("stale");
  if (event.cause === "snapshot") return ignore("snapshot");
  if (event.origin === HYPRNAV_T3_ORIGIN) return ignore("own-origin");
  if (event.locked_environment_id === null) return ignore("unlocked");

  const ref = resolveLockedThread(event.locked_environment_id, input);
  if (typeof ref === "string") return ignore(ref);
  if (input.currentRouteRef && scopedThreadKey(input.currentRouteRef) === scopedThreadKey(ref)) {
    return ignore("current");
  }
  const shell = input.readThreadShell(ref);
  if (!shell) return ignore("unknown-thread");
  if (shell.archivedAt !== null) return ignore("archived");
  return { kind: "navigate", ref };
}

/**
 * The thread envs an event names (as the new or the previous lock), keyed by
 * thread id, so the follower can later tell a worktree env is the ancestor of
 * the thread on screen.
 */
export function hyprnavThreadEnvIdsInEvent(
  event: HyprnavLockedEvent,
): ReadonlyArray<readonly [threadId: string, envId: string]> {
  return [event.locked_environment_id, event.previous_environment_id].flatMap((id) => {
    if (id === null) return [];
    const parsed = parseHyprnavEnvironmentId(id);
    return parsed?.scope === "thread" ? [[parsed.threadId, id] as const] : [];
  });
}

/** How long a follow mark vouches for its thread's publish. */
const FOLLOW_MARK_TTL_MS = 5_000;

let followMark: { readonly key: string; readonly at: number } | null = null;

/** Records that the follower is about to navigate to `ref`. */
export function markFollowedThread(ref: ScopedThreadRef, now = Date.now()): void {
  followMark = { key: scopedThreadKey(ref), at: now };
}

/**
 * Whether the thread about to be published was just opened by the follower,
 * in which case publishing must not lock it again: hyprnav already did, and a
 * late lock could undo a newer one. Publishing any other thread clears the
 * mark; its own thread keeps it briefly so an immediate re-run of the same
 * publish (a StrictMode remount) stays lock-free too.
 */
export function consumeFollowedThread(ref: ScopedThreadRef, now = Date.now()): boolean {
  if (followMark?.key === scopedThreadKey(ref) && now - followMark.at < FOLLOW_MARK_TTL_MS) {
    return true;
  }
  followMark = null;
  return false;
}
