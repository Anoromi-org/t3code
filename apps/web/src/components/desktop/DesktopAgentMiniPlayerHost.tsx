"use client";

/**
 * Opens and closes the desktop-agent mini player on its own.
 *
 * This is the only place that decides a thread should be showing a window: the
 * agent registry says which thread it is working for (the provider adapters
 * export T3CODE_THREAD_ID / T3CODE_ENVIRONMENT_ID into the agent process, and
 * hyprnav reports them back), so the view can appear without the user having
 * asked for it and go away when the agent is done.
 *
 * Rendered once at the app root and not gated on Electron: the frames route is
 * served by the same origin in web mode too.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, type ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { useDesktopAgentMiniPlayerStore } from "~/desktopAgentMiniPlayerStore";
import { useDesktopAgents } from "~/desktopAgentsStore";

import { shouldShowDesktopAgentMiniPlayer } from "./shouldShowDesktopAgentMiniPlayer";

/**
 * How long a finished or idle agent's window stays up. Agents go quiet between
 * steps, and a view that blinks out and back is worse than one that lingers.
 */
const CLOSE_GRACE_MS = 5_000;

export function DesktopAgentMiniPlayerHost() {
  const { agents } = useDesktopAgents();
  const closeTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const threadRefsRef = useRef(new Map<string, ScopedThreadRef>());

  useEffect(() => {
    const timers = closeTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!agents) return;
    const store = useDesktopAgentMiniPlayerStore.getState();
    const timers = closeTimersRef.current;
    const threadRefs = threadRefsRef.current;
    const showing = new Set<string>();

    for (const agent of agents) {
      const threadId = agent.thread_id;
      const environmentId = agent.thread_environment_id;
      const target = agent.current_target;
      if (!threadId || !environmentId || !target) continue;
      if (!shouldShowDesktopAgentMiniPlayer(agent)) continue;
      // Closing by hand suppresses this agent until it has something new to
      // say, so an unwanted view stays gone but a later "needs you" is not lost.
      if (store.dismissedByAgentId[agent.agent_id] === agent.state) continue;
      const threadRef = scopeThreadRef(environmentId as EnvironmentId, ThreadId.make(threadId));
      const threadKey = scopedThreadKey(threadRef);
      threadRefs.set(threadKey, threadRef);
      showing.add(threadKey);
      const pending = timers.get(threadKey);
      if (pending !== undefined) {
        clearTimeout(pending);
        timers.delete(threadKey);
      }
      store.open(threadRef, agent.agent_id, target);
    }

    for (const [threadKey, entry] of Object.entries(store.byThreadKey)) {
      if (showing.has(threadKey)) continue;
      const threadRef = threadRefs.get(threadKey);
      if (!threadRef) continue;
      const stillRegistered = agents.some((agent) => agent.agent_id === entry.agentId);
      if (!stillRegistered) {
        const pending = timers.get(threadKey);
        if (pending !== undefined) clearTimeout(pending);
        timers.delete(threadKey);
        useDesktopAgentMiniPlayerStore.getState().close(threadRef);
        continue;
      }
      if (timers.has(threadKey)) continue;
      timers.set(
        threadKey,
        setTimeout(() => {
          timers.delete(threadKey);
          useDesktopAgentMiniPlayerStore.getState().close(threadRef);
        }, CLOSE_GRACE_MS),
      );
    }
  }, [agents]);

  return null;
}
