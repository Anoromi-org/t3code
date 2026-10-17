import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { isAnyCommandSurfaceOpen } from "../commandSurface";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";
import { useProjects, useThreadShells } from "../state/entities";
import {
  recentThreadTargetKey,
  type RecentThreadTarget,
  useRecentThreadStore,
} from "../recentThreadStore";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import { RecentThreadSwitcher } from "./RecentThreadSwitcher";
import { resolveRecentThreadSwitcherItems } from "./RecentThreadSwitcher.logic";

/**
 * Fork: the desktop Ctrl+Tab recent-thread switcher. Electron main owns the
 * gesture and sends advance, commit, and cancel actions; this records visits
 * and resolves the frozen MRU list against live threads and drafts.
 */
export function RecentThreadSwitcherControl() {
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useThreadShells();
  const routeTarget = useThreadRouteTarget();
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const cycle = useRecentThreadStore((state) => state.cycle);

  const resolveTargets = (targets: ReadonlyArray<RecentThreadTarget>) =>
    resolveRecentThreadSwitcherItems({
      targets,
      projects,
      threads,
      draftsById: draftThreadsByThreadKey,
    });
  const resolvedCycleItems = resolveTargets(cycle?.targets ?? []);

  // Only live, unarchived threads and unpromoted drafts are worth revisiting.
  const visitTarget = ((): RecentThreadTarget | null => {
    if (!routeTarget) return null;
    if (routeTarget.kind === "server") {
      const key = scopedThreadKey(routeTarget.threadRef);
      const live = threads.some(
        (thread) =>
          thread.archivedAt === null &&
          scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }) === key,
      );
      return live ? routeTarget : null;
    }
    const draft = draftThreadsByThreadKey[routeTarget.draftId];
    if (!draft || draft.promotedTo) return null;
    return { kind: "draft", draftId: DraftId.make(routeTarget.draftId) };
  })();
  const visitKey = visitTarget ? recentThreadTargetKey(visitTarget) : null;
  const recordVisit = useEffectEvent((key: string | null) => {
    if (key !== null && visitTarget) useRecentThreadStore.getState().recordVisit(visitTarget);
  });
  useEffect(() => recordVisit(visitKey), [visitKey]);

  const navigateToTarget = (target: RecentThreadTarget) => {
    if (target.kind === "server") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target.threadRef),
      });
      return;
    }
    void navigate({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(target.draftId) });
  };

  // Drops targets that disappeared (archived, deleted, cleared drafts) and
  // swaps promoted drafts for their thread before the store is read.
  const reconcileTargets = () => {
    const state = useRecentThreadStore.getState();
    const highlighted = state.cycle?.targets[state.cycle.highlightedIndex];
    state.reconcile(
      resolveTargets(state.history).map((item) => item.target),
      state.cycle ? resolveTargets(state.cycle.targets).map((item) => item.target) : undefined,
      highlighted ? resolveTargets([highlighted])[0]?.target : undefined,
    );
  };

  const commit = (target?: RecentThreadTarget) => {
    const state = useRecentThreadStore.getState();
    const selectedTarget =
      target ?? (state.cycle ? state.cycle.targets[state.cycle.highlightedIndex] : undefined);
    const canonicalTarget = selectedTarget
      ? (resolveTargets([selectedTarget])[0]?.target ?? null)
      : null;
    reconcileTargets();
    if (!canonicalTarget) {
      useRecentThreadStore.getState().cancel();
      return;
    }
    const selected = useRecentThreadStore.getState().commit(canonicalTarget);
    if (selected) navigateToTarget(selected);
  };

  const onThreadSwitcherAction = useEffectEvent((action: string) => {
    if (action === "advance-forward" || action === "advance-backward") {
      if (isAnyCommandSurfaceOpen("thread-switcher")) return;
      // Reconcile lazily at gesture start. Writing resolved targets back during
      // render can oscillate while a draft is promoted.
      reconcileTargets();
      useRecentThreadStore
        .getState()
        .advance(action === "advance-forward" ? "forward" : "backward");
      return;
    }
    if (action === "commit") {
      commit();
      return;
    }
    useRecentThreadStore.getState().cancel();
  });
  useEffect(() => {
    const subscribe = window.desktopBridge?.onThreadSwitcherAction;
    if (typeof subscribe !== "function") return;
    return subscribe((action) => onThreadSwitcherAction(action));
  }, []);

  // Match on the resolved target: a draft promoted mid-gesture is listed, and
  // committed, as its thread.
  const highlightedTarget = cycle?.targets[cycle.highlightedIndex] ?? null;
  const highlightedItemTarget = highlightedTarget
    ? (resolveTargets([highlightedTarget])[0]?.target ?? null)
    : null;
  const highlightedIndex = highlightedItemTarget
    ? resolvedCycleItems.findIndex(
        (item) =>
          recentThreadTargetKey(item.target) === recentThreadTargetKey(highlightedItemTarget),
      )
    : 0;

  return (
    <RecentThreadSwitcher
      open={cycle !== null && resolvedCycleItems.length >= 2}
      items={resolvedCycleItems}
      highlightedIndex={Math.max(0, highlightedIndex)}
      onCancel={() => useRecentThreadStore.getState().cancel()}
      onSelect={commit}
    />
  );
}
