/**
 * Desktop agents: cua MCP processes that hyprnav tracks on this machine.
 * Each one owns a frame (workspace) and reports what window it is acting on.
 * "Watch" opens a live PipeWire view of that window inside the panel, with no
 * share-picker dialog: the desktop pre-answers the portal picker with the
 * window address before calling getDisplayMedia.
 */
import type { DesktopHyprnavAgent } from "@t3tools/contracts";
import { Eye, EyeOff, Monitor, MoveRight, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary/target";

/**
 * Electron exposes hyprnav through the preload bridge. In a browser on the
 * same machine the server's loopback-only /api/hyprnav routes stand in.
 */
interface HyprnavClient {
  readonly list: () => Promise<ReadonlyArray<DesktopHyprnavAgent>>;
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
      if (!response.ok) return [];
      return (await response.json()) as ReadonlyArray<DesktopHyprnavAgent>;
    },
    screencast: (address) => post("/api/hyprnav/screencast", { address }),
    goto: (env, slot) => post("/api/hyprnav/goto", { env, slot }),
  };
}

const hyprnavClient = resolveHyprnavClient();

const STATE_VISUALS: Record<string, { dotClass: string; label: string; pulse?: boolean }> = {
  working: { dotClass: "bg-info", label: "Working", pulse: true },
  waiting_for_user: { dotClass: "bg-warning", label: "Needs you" },
  idle: { dotClass: "bg-muted-foreground/50", label: "Idle" },
  finished: { dotClass: "bg-muted-foreground/60", label: "Finished" },
};

/**
 * One subscription per page, shared by the panel and the tab badge.
 *
 * The server pushes the registry over SSE (/api/hyprnav/events), which is fed
 * by hyprnav's event socket, so nothing polls in the steady state. Polling is
 * kept only as a fallback for when EventSource is missing or the stream keeps
 * failing to open.
 */
interface DesktopAgentsSnapshot {
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
      .then((next) => publish({ agents: next, connected: true }))
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
    // EventSource retries on its own; only a run of failures means the route
    // is not there (old server, no loopback) and polling should take over.
    sseFailures += 1;
    if (sseFailures < SSE_FAILURE_LIMIT) return;
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

function useDesktopAgents(): DesktopAgentsSnapshot {
  return useSyncExternalStore(subscribeToDesktopAgents, readSnapshot, readServerSnapshot);
}

/** Live agents only: hyprnav keeps finished ones until the daemon restarts. */
function liveAgents(
  agents: ReadonlyArray<DesktopHyprnavAgent> | null,
): ReadonlyArray<DesktopHyprnavAgent> | null {
  return agents?.filter((agent) => agent.state !== "finished") ?? null;
}

function AgentPortal({
  stream,
  error,
  onClose,
}: {
  stream: MediaStream | null;
  error: string | null;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  }, [stream]);

  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        className="block aspect-video w-full object-contain"
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted-foreground">
          Live view unavailable: {error}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-1.5 right-1.5 rounded bg-black/60 p-1 text-white/80 hover:text-white"
        aria-label="Stop watching"
      >
        <EyeOff className="size-3.5" />
      </button>
    </div>
  );
}

function AgentRow({ agent }: { agent: DesktopHyprnavAgent }) {
  const [watching, setWatching] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const visual = STATE_VISUALS[agent.state] ?? STATE_VISUALS.idle!;
  const target = agent.current_target;
  const goThere = useCallback(() => {
    void hyprnavClient?.goto(agent.environment_id, agent.slot_index);
  }, [agent.environment_id, agent.slot_index]);
  const canWatch = Boolean(target) && agent.state !== "finished";

  const stopStream = useCallback(() => {
    const current = streamRef.current;
    streamRef.current = null;
    setStream(null);
    if (current) for (const track of current.getTracks()) track.stop();
  }, []);

  useEffect(() => stopStream, [stopStream]);

  /**
   * The portal is pre-answered before the picker ever runs, but the pre-answer
   * must not be awaited here: awaiting spends the click's transient user
   * activation and getDisplayMedia then fails with NotAllowedError. The request
   * is posted on pointer-down, so it is already on disk (valid for 15 s) by the
   * time this handler calls getDisplayMedia in the same task as the click.
   */
  const preAnswer = useCallback(() => {
    if (!target || watching) return;
    void hyprnavClient?.screencast(target);
  }, [target, watching]);

  const toggleWatch = useCallback(() => {
    if (watching) {
      setWatching(false);
      setError(null);
      stopStream();
      return;
    }
    if (!target) return;
    setWatching(true);
    setError(null);
    void hyprnavClient?.screencast(target);
    navigator.mediaDevices
      .getDisplayMedia({ video: true, audio: false })
      .then((next) => {
        streamRef.current = next;
        setStream(next);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [watching, target, stopStream]);

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-2">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            visual.dotClass,
            visual.pulse && "animate-pulse",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.label}</span>
        <span className="text-xs text-muted-foreground">{visual.label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Monitor aria-hidden className="size-3" />
        <span className="truncate">
          frame on workspace {agent.workspace_id}
          {agent.last_action ? ` · ${agent.last_action}` : ""}
          {agent.action_count > 0 ? ` · ${agent.action_count} actions` : ""}
        </span>
      </div>
      <div className="mt-2 flex gap-1.5">
        <Button
          size="xs"
          variant={watching ? "secondary" : "outline"}
          disabled={!canWatch}
          onPointerDown={preAnswer}
          onClick={toggleWatch}
        >
          <Eye className="size-3" />
          {watching ? "Watching" : "Watch"}
        </Button>
        <Button size="xs" variant="ghost" onClick={goThere}>
          <MoveRight className="size-3" />
          Go there
        </Button>
      </div>
      {watching ? (
        <div className="mt-2">
          <AgentPortal
            stream={stream}
            error={error}
            onClose={() => {
              setWatching(false);
              setError(null);
              stopStream();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Returns null when the bridge is absent (browser build, other platforms) or nothing is registered. */
export function DesktopAgentsSection() {
  const { agents: all, connected } = useDesktopAgents();
  const agents = liveAgents(all);
  if (!agents || agents.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1.5 p-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">Desktop agents</span>
        {connected ? (
          <span className="text-xs text-muted-foreground">{agents.length}</span>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex items-center gap-1 text-xs text-warning">
                  <WifiOff aria-hidden className="size-3" />
                  disconnected
                </span>
              }
            />
            <TooltipPopup side="top">
              Lost the connection to hyprnav; this list may be stale.
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
      {agents.map((agent) => (
        <AgentRow key={agent.agent_id} agent={agent} />
      ))}
    </section>
  );
}

export function useDesktopAgentCount(): number {
  const { agents } = useDesktopAgents();
  return liveAgents(agents)?.length ?? 0;
}
