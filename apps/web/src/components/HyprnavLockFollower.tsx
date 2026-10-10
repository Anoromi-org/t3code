import type { ClientSettings, DesktopHyprnavAgent, HyprnavLockedEvent } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

import { isElectron } from "../env";
import { useClientSettings } from "../hooks/useSettings";
import { subscribeHyprnavEventStream } from "../hyprnavEventStream";
import {
  decideHyprnavFollow,
  hyprnavThreadEnvIdsInEvent,
  markFollowedThread,
} from "../hyprnavLockFollower";
import { readThreadShell } from "../state/entities";
import { usePrimaryEnvironmentId } from "../state/environments";
import { buildThreadRouteParams, resolveThreadRouteRef } from "../threadRoutes";

/** Coalesces a fast A→B→C in hyprnav into one navigation. */
const FOLLOW_DEBOUNCE_MS = 150;

const selectFollowLock = (settings: ClientSettings) => settings.hyprnavFollowLock;

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function parseLockedEvent(data: string): HyprnavLockedEvent | null {
  const parsed = parseJson(data) as Partial<HyprnavLockedEvent> | null;
  if (typeof parsed?.seq !== "number" || parsed.locked_environment_id === undefined) return null;
  return parsed as HyprnavLockedEvent;
}

/**
 * Opens the thread hyprnav locks, silently: the window is never raised, since
 * hyprnav already picked the workspace. Holds the shared event stream only
 * while following is on.
 */
export function HyprnavLockFollower() {
  const enabled = useClientSettings(selectFollowLock) ?? isElectron;
  const navigate = useNavigate();
  const routeRef = useParams({ strict: false, select: resolveThreadRouteRef });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const follow = useEffectEvent(
    (input: {
      readonly event: HyprnavLockedEvent;
      readonly baselineSeq: number | null;
      readonly agents: ReadonlyArray<DesktopHyprnavAgent> | null;
      readonly threadEnvIds: ReadonlyMap<string, string>;
    }) => {
      const decision = decideHyprnavFollow({
        event: input.event,
        baselineSeq: input.baselineSeq,
        currentRouteRef: routeRef,
        currentThreadEnvId: routeRef ? (input.threadEnvIds.get(routeRef.threadId) ?? null) : null,
        primaryEnvironmentId,
        readThreadShell,
        agents: input.agents,
      });
      if (decision.kind !== "navigate") return;
      markFollowedThread(decision.ref);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(decision.ref),
      });
    },
  );

  useEffect(() => {
    if (!enabled) return;
    let baselineSeq: number | null = null;
    let agents: ReadonlyArray<DesktopHyprnavAgent> | null = null;
    let pending: HyprnavLockedEvent | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const threadEnvIds = new Map<string, string>();

    const flush = () => {
      timer = null;
      const event = pending;
      pending = null;
      if (!event) return;
      follow({ event, baselineSeq, agents, threadEnvIds });
    };

    // After a reconnect the replayed lock is a baseline again, not a request,
    // and anything still pending predates it.
    const resetBaseline = () => {
      baselineSeq = null;
      pending = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const release = subscribeHyprnavEventStream({
      onOpen: resetBaseline,
      onEvent: (name, data) => {
        if (name !== "locked") {
          const payload = parseJson(data) as {
            connected?: unknown;
            agents?: ReadonlyArray<DesktopHyprnavAgent>;
          } | null;
          // The daemon went away; its seq restarts with it.
          if (name === "status" && payload?.connected === false) resetBaseline();
          if (name === "agents" && Array.isArray(payload?.agents)) agents = payload.agents;
          return;
        }
        const event = parseLockedEvent(data);
        if (!event) return;
        for (const [threadId, envId] of hyprnavThreadEnvIdsInEvent(event)) {
          threadEnvIds.set(threadId, envId);
        }
        if (baselineSeq === null) {
          baselineSeq = event.seq;
          return;
        }
        if (pending && event.seq <= pending.seq) return;
        pending = event;
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(flush, FOLLOW_DEBOUNCE_MS);
      },
    });

    return () => {
      release();
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled]);

  return null;
}
