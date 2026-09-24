/**
 * The one live view of hyprnav's desktop-agent registry this page holds.
 *
 * The server pushes the registry over SSE (/api/hyprnav/events), which is fed
 * by hyprnav's event socket, so nothing polls in the steady state. Polling is
 * kept only as a fallback for when EventSource is missing or the stream keeps
 * failing to open. It lives outside any component because several read it —
 * the Agents panel, the floating mini player host and the player itself — and
 * a second subscription would mean a second stream.
 */
import type { DesktopHyprnavAgent } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "./environments/primary/target";

/**
 * Electron exposes hyprnav through the preload bridge. In a browser on the
 * same machine the server's loopback-only /api/hyprnav routes stand in.
 */
interface HyprnavClient {
  /** Null when this client cannot reach hyprnav at all (e.g. not a loopback host). */
  readonly list: () => Promise<ReadonlyArray<DesktopHyprnavAgent> | null>;
  readonly screencast: (address: string) => Promise<unknown>;
  readonly goto: (env: string, slot: number) => Promise<unknown>;
}

function resolveHyprnavClient(): HyprnavClient | null {
  const bridge = typeof window !== "undefined" ? window.desktopBridge : undefined;
  if (bridge?.listHyprnavAgents) {
    return {
      list: () => bridge.listHyprnavAgents!(),
      screencast: (address) =>
        bridge.requestHyprnavScreencast?.({ address }) ?? Promise.resolve(null),
      goto: (env, slot) => bridge.gotoHyprnavAgent?.({ env, slot }) ?? Promise.resolve(null),
    };
  }
  if (typeof window === "undefined") return null;
  const post = (path: string, body: unknown) =>
    fetch(resolvePrimaryEnvironmentHttpUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    list: async () => {
      const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/hyprnav/agents"));
      // 404: an older server, or a host the loopback-only routes refuse.
      if (response.status === 404) return null;
      if (!response.ok) return [];
      return (await response.json()) as ReadonlyArray<DesktopHyprnavAgent>;
    },
    screencast: (address) => post("/api/hyprnav/screencast", { address }),
    goto: (env, slot) => post("/api/hyprnav/goto", { env, slot }),
  };
}

export const hyprnavClient = resolveHyprnavClient();

interface DesktopAgentStateVisual {
  readonly dotClass: string;
  readonly label: string;
}

const IDLE_VISUAL: DesktopAgentStateVisual = { dotClass: "bg-muted-foreground/50", label: "Idle" };

const STATE_VISUALS: Readonly<Record<string, DesktopAgentStateVisual>> = {
  working: { dotClass: "bg-info", label: "Working" },
  waiting_for_user: { dotClass: "bg-warning", label: "Needs you" },
  idle: IDLE_VISUAL,
  finished: { dotClass: "bg-muted-foreground/60", label: "Finished" },
};

/** How a registry state is spelled and coloured wherever an agent is shown. */
export function desktopAgentStateVisual(state: string): DesktopAgentStateVisual {
  return STATE_VISUALS[state] ?? IDLE_VISUAL;
}

export interface DesktopAgentsSnapshot {
  readonly agents: ReadonlyArray<DesktopHyprnavAgent> | null;
  /** Upstream daemon health as reported by the server; true until told otherwise. */
  readonly connected: boolean;
}

const EMPTY_SNAPSHOT: DesktopAgentsSnapshot = { agents: null, connected: true };

const POLL_INTERVAL_MS = 1500;
/** Consecutive EventSource failures before giving up on the stream for good. */
const SSE_FAILURE_LIMIT = 3;

let snapshot: DesktopAgentsSnapshot = EMPTY_SNAPSHOT;
const storeListeners = new Set<() => void>();
let subscriberCount = 0;
let eventSource: EventSource | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let sseFailures = 0;

function publish(next: Partial<DesktopAgentsSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  // Copying is deliberate: a listener may unsubscribe while being notified.
  for (const listener of Array.from(storeListeners)) listener();
}

function resolveEventsUrl(): string | null {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return null;
  try {
    return resolvePrimaryEnvironmentHttpUrl("/api/hyprnav/events");
  } catch {
    return null;
  }
}

function startPolling(): void {
  const client = hyprnavClient;
  if (pollTimer !== null || !client) return;
  const tick = () => {
    client
      .list()
      .then((next) => {
        if (next === null) {
          // Nothing will change by asking again.
          stopPolling();
          publish({ agents: [], connected: true });
          return;
        }
        publish({ agents: next, connected: true });
      })
      .catch(() => publish({ agents: [] }));
  };
  tick();
  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

function startStream(url: string): void {
  const source = new EventSource(url);
  eventSource = source;
  source.addEventListener("open", () => {
    sseFailures = 0;
    stopPolling();
  });
  source.addEventListener("agents", (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as { agents?: ReadonlyArray<DesktopHyprnavAgent> };
      if (Array.isArray(payload.agents)) publish({ agents: payload.agents });
    } catch {
      // A malformed line is the daemon's problem; keep the last good list.
    }
  });
  source.addEventListener("status", (event: MessageEvent<string>) => {
    try {
      const payload = JSON.parse(event.data) as { connected?: boolean };
      if (typeof payload.connected === "boolean") publish({ connected: payload.connected });
    } catch {
      // ignore
    }
  });
  source.addEventListener("error", () => {
    // EventSource retries network errors on its own; only a run of them, or a
    // response it will not retry (404 from an older server or a non-loopback
    // host closes it for good), hands over to polling.
    sseFailures += 1;
    if (source.readyState !== EventSource.CLOSED && sseFailures < SSE_FAILURE_LIMIT) return;
    source.close();
    if (eventSource === source) eventSource = null;
    publish({ connected: true });
    startPolling();
  });
}

function openSource(): void {
  const url = resolveEventsUrl();
  if (url === null) {
    startPolling();
    return;
  }
  startStream(url);
}

function closeSource(): void {
  stopPolling();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  sseFailures = 0;
  snapshot = EMPTY_SNAPSHOT;
}

function subscribeToDesktopAgents(listener: () => void): () => void {
  storeListeners.add(listener);
  subscriberCount += 1;
  if (subscriberCount === 1 && hyprnavClient) openSource();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    storeListeners.delete(listener);
    subscriberCount -= 1;
    if (subscriberCount === 0) closeSource();
  };
}

function readSnapshot(): DesktopAgentsSnapshot {
  return snapshot;
}

function readServerSnapshot(): DesktopAgentsSnapshot {
  return EMPTY_SNAPSHOT;
}

export function useDesktopAgents(): DesktopAgentsSnapshot {
  return useSyncExternalStore(subscribeToDesktopAgents, readSnapshot, readServerSnapshot);
}

/** Live agents only: hyprnav keeps finished ones until the daemon restarts. */
export function liveAgents(
  agents: ReadonlyArray<DesktopHyprnavAgent> | null,
): ReadonlyArray<DesktopHyprnavAgent> | null {
  return agents?.filter((agent) => agent.state !== "finished") ?? null;
}
