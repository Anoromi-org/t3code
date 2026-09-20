/**
 * Desktop agents: cua MCP processes that hyprnav tracks on this machine.
 * Each one owns a frame (workspace) and reports what window it is acting on.
 * "Watch" opens a live PipeWire view of that window inside the panel, with no
 * share-picker dialog: the desktop pre-answers the portal picker with the
 * window address before calling getDisplayMedia.
 */
import type { DesktopHyprnavAgent } from "@t3tools/contracts";
import { Eye, EyeOff, Monitor, MoveRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
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
      screencast: (address) => bridge.requestHyprnavScreencast?.({ address }) ?? Promise.resolve(null),
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

function useDesktopAgents(intervalMs = 1500): ReadonlyArray<DesktopHyprnavAgent> | null {
  const [agents, setAgents] = useState<ReadonlyArray<DesktopHyprnavAgent> | null>(null);
  useEffect(() => {
    const client = hyprnavClient;
    if (!client) {
      return;
    }
    let cancelled = false;
    const tick = () => {
      client
        .list()
        .then((next) => {
          if (!cancelled) setAgents(next);
        })
        .catch(() => {
          if (!cancelled) setAgents([]);
        });
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);
  return agents;
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
  const all = useDesktopAgents();
  // Finished agents stay in hyprnav's registry until the daemon restarts; the
  // dashboard shows only live ones, like the badge count does.
  const agents = all?.filter((agent) => agent.state !== "finished");
  if (!agents || agents.length === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-1.5 p-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">Desktop agents</span>
        <span className="text-xs text-muted-foreground">{agents.length}</span>
      </div>
      {agents.map((agent) => (
        <AgentRow key={agent.agent_id} agent={agent} />
      ))}
    </section>
  );
}

export function useDesktopAgentCount(): number {
  const agents = useDesktopAgents(3000);
  return agents?.filter((agent) => agent.state !== "finished").length ?? 0;
}
