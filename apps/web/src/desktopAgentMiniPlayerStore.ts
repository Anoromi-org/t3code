/**
 * Floating live views of the window a desktop (computer-use) agent is working
 * on, one per thread.
 *
 * Deliberately separate from previewMiniPlayerStore even though the layout
 * state is the same shape: ChatView reaps preview entries whose tab is no
 * longer a live preview session, and a desktop agent's window is not a preview
 * tab. The identity guard here is the agent id, so a stale drag from a
 * departed agent cannot move the next one's window.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

import type { PreviewMiniPlayerPosition, PreviewMiniPlayerSize } from "./previewMiniPlayerStore";

export interface DesktopAgentMiniPlayerState {
  readonly agentId: string;
  /** Hyprland handle of the toplevel being streamed. */
  readonly address: string;
  readonly position: PreviewMiniPlayerPosition | null;
  readonly size: PreviewMiniPlayerSize | null;
}

interface DesktopAgentMiniPlayerStoreState {
  readonly byThreadKey: Record<string, DesktopAgentMiniPlayerState>;
  /**
   * Agents the user closed by hand, against the state they were in. The host
   * re-opens once the agent moves on to a different state, so dismissing a
   * working agent does not also hide the "needs you" that follows.
   */
  readonly dismissedByAgentId: Record<string, string>;
  readonly open: (ref: ScopedThreadRef, agentId: string, address: string) => void;
  readonly close: (ref: ScopedThreadRef) => void;
  readonly dismiss: (ref: ScopedThreadRef, agentId: string, agentState: string) => void;
  readonly move: (
    ref: ScopedThreadRef,
    agentId: string,
    position: PreviewMiniPlayerPosition,
  ) => void;
  readonly resize: (ref: ScopedThreadRef, agentId: string, size: PreviewMiniPlayerSize) => void;
  readonly removeThread: (ref: ScopedThreadRef) => void;
}

export const useDesktopAgentMiniPlayerStore = create<DesktopAgentMiniPlayerStoreState>()((set) => ({
  byThreadKey: {},
  dismissedByAgentId: {},
  open: (ref, agentId, address) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (current?.agentId === agentId && current.address === address) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: {
            agentId,
            address,
            position: current?.position ?? null,
            size: current?.size ?? null,
          },
        },
      };
    }),
  close: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _closed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
  dismiss: (ref, agentId, agentState) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const { [threadKey]: _closed, ...byThreadKey } = state.byThreadKey;
      return {
        byThreadKey,
        dismissedByAgentId: { ...state.dismissedByAgentId, [agentId]: agentState },
      };
    }),
  move: (ref, agentId, position) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (!current || current.agentId !== agentId) return state;
      if (current.position?.x === position.x && current.position.y === position.y) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: { ...current, position },
        },
      };
    }),
  resize: (ref, agentId, size) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (!current || current.agentId !== agentId) return state;
      if (current.size?.width === size.width && current.size.height === size.height) return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: { ...current, size },
        },
      };
    }),
  removeThread: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
}));

export function selectThreadDesktopAgentMiniPlayer(
  byThreadKey: Record<string, DesktopAgentMiniPlayerState>,
  ref: ScopedThreadRef | null | undefined,
): DesktopAgentMiniPlayerState | null {
  if (!ref) return null;
  return byThreadKey[scopedThreadKey(ref)] ?? null;
}
