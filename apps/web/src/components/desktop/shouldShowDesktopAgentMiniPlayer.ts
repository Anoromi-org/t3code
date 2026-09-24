import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type DesktopHyprnavAgent,
  type EnvironmentId,
  type ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";

import type { PreviewMiniPlayerSource } from "~/previewMiniPlayerStore";

/** An idle agent can still have a window worth watching between actions. */
const VISIBLE_STATES = new Set(["working", "waiting_for_user", "idle"]);

/**
 * Whether a registered desktop agent should have a floating live view of its
 * window opened for it, with no click.
 *
 * All four conditions are needed: the thread ids say which thread the view
 * belongs to (older hyprnav daemons do not report them at all, and an agent
 * that T3 did not start has none), the target says which window to stream, and
 * the state keeps the view off screen once the agent is finished.
 */
export function shouldShowDesktopAgentMiniPlayer(agent: DesktopHyprnavAgent): boolean {
  if (!agent.thread_id || !agent.thread_environment_id) return false;
  if (!agent.current_target) return false;
  return VISIBLE_STATES.has(agent.state);
}

export interface DesktopAgentMiniPlayerTarget {
  readonly threadRef: ScopedThreadRef;
  readonly source: Extract<PreviewMiniPlayerSource, { kind: "desktop-agent" }>;
}

/**
 * The live view each thread should float right now, one per thread (the first
 * registered agent wins), leaving out agents the user dismissed in their
 * current state.
 */
export function resolveDesktopAgentMiniPlayerTargets(
  agents: ReadonlyArray<DesktopHyprnavAgent>,
  dismissedByAgentId: Readonly<Record<string, string>>,
): ReadonlyArray<DesktopAgentMiniPlayerTarget> {
  const byThreadKey = new Map<string, DesktopAgentMiniPlayerTarget>();
  for (const agent of agents) {
    const { thread_id: threadId, thread_environment_id: environmentId } = agent;
    const address = agent.current_target;
    if (!shouldShowDesktopAgentMiniPlayer(agent) || !threadId || !environmentId || !address) {
      continue;
    }
    if (dismissedByAgentId[agent.agent_id] === agent.state) continue;
    const threadRef = scopeThreadRef(environmentId as EnvironmentId, ThreadId.make(threadId));
    const threadKey = scopedThreadKey(threadRef);
    if (byThreadKey.has(threadKey)) continue;
    byThreadKey.set(threadKey, {
      threadRef,
      source: { kind: "desktop-agent", agentId: agent.agent_id, address },
    });
  }
  return [...byThreadKey.values()];
}
