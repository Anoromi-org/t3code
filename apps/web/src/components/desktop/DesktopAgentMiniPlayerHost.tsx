"use client";

/**
 * Opens and closes the floating live view of a desktop agent's window on its
 * own.
 *
 * The agent registry says which thread each agent works for (the provider
 * adapters export T3CODE_THREAD_ID / T3CODE_ENVIRONMENT_ID into the agent
 * process, and hyprnav reports them back), so the view can appear without the
 * user asking and go away when the agent finishes. It is an ordinary
 * `desktop-agent` source of the thread's preview mini player, so it never
 * replaces a floating browser tab or device, and it only opens by itself when
 * "auto-show floating preview" is on.
 *
 * Rendered once at the app root and not gated on Electron: the frames route is
 * served by the same origin in web mode too.
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import {
  staleDesktopAgentDismissals,
  useDesktopAgentMiniPlayerStore,
} from "~/desktopAgentMiniPlayerStore";
import { useDesktopAgents } from "~/desktopAgentsStore";
import { useClientSettings } from "~/hooks/useSettings";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";

import { resolveDesktopAgentMiniPlayerTargets } from "./shouldShowDesktopAgentMiniPlayer";

/** How long a finished agent's window stays up before the view closes. */
const CLOSE_GRACE_MS = 5_000;

const selectAutoShow = (settings: { browserAutoShowFloatingPreview: boolean }) =>
  settings.browserAutoShowFloatingPreview;

/** The agent floating on a thread, or null when the thread floats something else. */
function floatingAgentId(threadKey: string): string | null {
  const source = usePreviewMiniPlayerStore.getState().byThreadKey[threadKey]?.source;
  return source?.kind === "desktop-agent" ? source.agentId : null;
}

export function DesktopAgentMiniPlayerHost() {
  const { agents } = useDesktopAgents();
  const dismissedByAgentId = useDesktopAgentMiniPlayerStore((state) => state.dismissedByAgentId);
  const autoShow = useClientSettings(selectAutoShow);
  const closeTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Threads this host put an agent view on, so it knows which ones to take down. */
  const ownedRef = useRef(new Map<string, ScopedThreadRef>());

  useEffect(() => {
    const timers = closeTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!agents) return;
    const stale = staleDesktopAgentDismissals(agents, dismissedByAgentId);
    if (stale.length > 0) useDesktopAgentMiniPlayerStore.getState().forget(stale);
    const timers = closeTimersRef.current;
    const owned = ownedRef.current;
    const cancelClose = (threadKey: string) => {
      const pending = timers.get(threadKey);
      if (pending === undefined) return;
      clearTimeout(pending);
      timers.delete(threadKey);
    };
    const showing = new Set<string>();

    for (const { threadRef, source } of resolveDesktopAgentMiniPlayerTargets(
      agents,
      dismissedByAgentId,
    )) {
      const threadKey = scopedThreadKey(threadRef);
      showing.add(threadKey);
      cancelClose(threadKey);
      const current = usePreviewMiniPlayerStore.getState().byThreadKey[threadKey]?.source;
      // A floating browser tab or device was put there on purpose; leave it.
      if (current && current.kind !== "desktop-agent") continue;
      if (!current && !autoShow) continue;
      owned.set(threadKey, threadRef);
      usePreviewMiniPlayerStore.getState().open(threadRef, source);
    }

    for (const [threadKey, threadRef] of owned) {
      if (showing.has(threadKey)) continue;
      const agentId = floatingAgentId(threadKey);
      if (agentId === null) {
        // Closed by hand, or replaced by a browser tab or device.
        cancelClose(threadKey);
        owned.delete(threadKey);
        continue;
      }
      const closeIfStillFloating = () => {
        owned.delete(threadKey);
        if (floatingAgentId(threadKey) === agentId) {
          usePreviewMiniPlayerStore.getState().close(threadRef);
        }
      };
      if (!agents.some((agent) => agent.agent_id === agentId)) {
        cancelClose(threadKey);
        closeIfStillFloating();
        continue;
      }
      if (timers.has(threadKey)) continue;
      timers.set(
        threadKey,
        setTimeout(() => {
          timers.delete(threadKey);
          closeIfStillFloating();
        }, CLOSE_GRACE_MS),
      );
    }
  }, [agents, autoShow, dismissedByAgentId]);

  return null;
}
