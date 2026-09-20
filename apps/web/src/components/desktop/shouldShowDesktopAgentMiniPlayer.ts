import type { DesktopHyprnavAgent } from "@t3tools/contracts";

/** Agent states that mean there is something worth looking at right now. */
const ACTIVE_STATES = new Set(["working", "waiting_for_user"]);

/**
 * Whether a registered desktop agent should have a floating live view of its
 * window opened for it, with no click.
 *
 * All four conditions are needed: the thread ids say which thread the view
 * belongs to (older hyprnav daemons do not report them at all, and an agent
 * that T3 did not start has none), the target says which window to stream, and
 * the state keeps the view off screen once the agent is done.
 */
export function shouldShowDesktopAgentMiniPlayer(agent: DesktopHyprnavAgent): boolean {
  if (!agent.thread_id || !agent.thread_environment_id) return false;
  if (!agent.current_target) return false;
  return ACTIVE_STATES.has(agent.state);
}
