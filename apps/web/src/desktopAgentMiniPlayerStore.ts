/**
 * Which desktop agents the user closed the floating live view of by hand.
 *
 * The view itself lives in previewMiniPlayerStore as a `desktop-agent` source;
 * this only remembers the dismissal, against the state the agent was in, so
 * DesktopAgentMiniPlayerHost does not reopen it on the next registry update.
 * Once the agent moves to a different state the dismissal is forgotten and the
 * view may open again, so dismissing a working agent does not also hide the
 * "needs you" that follows, nor its next working stretch.
 */
import { create } from "zustand";

interface DesktopAgentMiniPlayerStoreState {
  readonly dismissedByAgentId: Record<string, string>;
  readonly dismiss: (agentId: string, agentState: string) => void;
  readonly forget: (agentIds: ReadonlyArray<string>) => void;
}

export const useDesktopAgentMiniPlayerStore = create<DesktopAgentMiniPlayerStoreState>()((set) => ({
  dismissedByAgentId: {},
  dismiss: (agentId, agentState) =>
    set((state) =>
      state.dismissedByAgentId[agentId] === agentState
        ? state
        : { dismissedByAgentId: { ...state.dismissedByAgentId, [agentId]: agentState } },
    ),
  forget: (agentIds) =>
    set((state) => {
      if (!agentIds.some((agentId) => agentId in state.dismissedByAgentId)) return state;
      const dismissedByAgentId = { ...state.dismissedByAgentId };
      for (const agentId of agentIds) delete dismissedByAgentId[agentId];
      return { dismissedByAgentId };
    }),
}));

/** Dismissals whose agent left the registry or moved on to another state. */
export function staleDesktopAgentDismissals(
  agents: ReadonlyArray<{ readonly agent_id: string; readonly state: string }>,
  dismissedByAgentId: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  return Object.entries(dismissedByAgentId)
    .filter(
      ([agentId, dismissedState]) =>
        agents.find((agent) => agent.agent_id === agentId)?.state !== dismissedState,
    )
    .map(([agentId]) => agentId);
}
