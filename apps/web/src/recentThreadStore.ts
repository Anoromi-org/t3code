import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import type { DraftId } from "./composerDraftStore";

export type RecentThreadTarget =
  | {
      readonly kind: "server";
      readonly threadRef: ScopedThreadRef;
    }
  | {
      readonly kind: "draft";
      readonly draftId: DraftId;
    };

export interface RecentThreadCycle {
  readonly targets: ReadonlyArray<RecentThreadTarget>;
  readonly highlightedIndex: number;
}

interface RecentThreadState {
  readonly history: ReadonlyArray<RecentThreadTarget>;
  readonly cycle: RecentThreadCycle | null;
  readonly recordVisit: (target: RecentThreadTarget) => void;
  readonly reconcile: (
    history: ReadonlyArray<RecentThreadTarget>,
    cycleTargets?: ReadonlyArray<RecentThreadTarget>,
  ) => void;
  readonly advance: (direction: "forward" | "backward") => void;
  readonly commit: (target?: RecentThreadTarget) => RecentThreadTarget | null;
  readonly cancel: () => void;
  readonly reset: () => void;
}

export function recentThreadTargetKey(target: RecentThreadTarget): string {
  return target.kind === "server"
    ? `server:${scopedThreadKey(target.threadRef)}`
    : `draft:${target.draftId}`;
}

export function sameRecentThreadTarget(
  left: RecentThreadTarget,
  right: RecentThreadTarget,
): boolean {
  return recentThreadTargetKey(left) === recentThreadTargetKey(right);
}

export function promoteRecentThreadTarget(
  history: ReadonlyArray<RecentThreadTarget>,
  target: RecentThreadTarget,
): RecentThreadTarget[] {
  const targetKey = recentThreadTargetKey(target);
  return [target, ...history.filter((entry) => recentThreadTargetKey(entry) !== targetKey)];
}

export function dedupeRecentThreadTargets(
  targets: ReadonlyArray<RecentThreadTarget>,
): RecentThreadTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = recentThreadTargetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameTargetList(
  left: ReadonlyArray<RecentThreadTarget>,
  right: ReadonlyArray<RecentThreadTarget>,
): boolean {
  return (
    left.length === right.length &&
    left.every((target, index) => {
      const other = right[index];
      return other !== undefined && sameRecentThreadTarget(target, other);
    })
  );
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

export const useRecentThreadStore = create<RecentThreadState>((set, get) => ({
  history: [],
  cycle: null,
  recordVisit: (target) => {
    set((state) => {
      if (state.cycle !== null) return state;
      const history = promoteRecentThreadTarget(state.history, target);
      return sameTargetList(history, state.history) ? state : { ...state, history };
    });
  },
  reconcile: (rawHistory, rawCycleTargets) => {
    const history = dedupeRecentThreadTargets(rawHistory);
    set((state) => {
      if (state.cycle === null) {
        return sameTargetList(history, state.history) ? state : { ...state, history };
      }

      const targets = dedupeRecentThreadTargets(rawCycleTargets ?? state.cycle.targets);
      if (targets.length < 2) {
        return { ...state, history, cycle: null };
      }
      const highlightedTarget = state.cycle.targets[state.cycle.highlightedIndex] ?? null;
      const highlightedIndex = highlightedTarget
        ? Math.max(
            0,
            targets.findIndex((target) => sameRecentThreadTarget(target, highlightedTarget)),
          )
        : 0;
      const cycle = { targets, highlightedIndex };
      return sameTargetList(history, state.history) &&
        sameTargetList(targets, state.cycle.targets) &&
        highlightedIndex === state.cycle.highlightedIndex
        ? state
        : { ...state, history, cycle };
    });
  },
  advance: (direction) => {
    set((state) => {
      if (state.cycle === null) {
        if (state.history.length < 2) return state;
        const highlightedIndex = direction === "forward" ? 1 : state.history.length - 1;
        return {
          ...state,
          cycle: {
            targets: [...state.history],
            highlightedIndex,
          },
        };
      }

      const delta = direction === "forward" ? 1 : -1;
      return {
        ...state,
        cycle: {
          ...state.cycle,
          highlightedIndex: wrapIndex(
            state.cycle.highlightedIndex + delta,
            state.cycle.targets.length,
          ),
        },
      };
    });
  },
  commit: (target) => {
    const state = get();
    const selected =
      target ?? (state.cycle ? (state.cycle.targets[state.cycle.highlightedIndex] ?? null) : null);
    if (!selected) return null;
    set({
      history: promoteRecentThreadTarget(state.history, selected),
      cycle: null,
    });
    return selected;
  },
  cancel: () => set((state) => (state.cycle === null ? state : { ...state, cycle: null })),
  reset: () => set({ history: [], cycle: null }),
}));
