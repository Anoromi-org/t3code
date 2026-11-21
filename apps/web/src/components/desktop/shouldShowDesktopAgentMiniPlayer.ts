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
 * Older daemons and agents T3 did not start report no thread ids; the target
 * says which window to stream; the state hides the view once the agent is done.
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
