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

const STATE_VISUALS: Record<string, { dotClass: string; label: string; pulse?: boolean }> = {
  working: { dotClass: "bg-info", label: "Working", pulse: true },
  waiting_for_user: { dotClass: "bg-warning", label: "Needs you" },
  idle: { dotClass: "bg-muted-foreground/50", label: "Idle" },
  finished: { dotClass: "bg-muted-foreground/60", label: "Finished" },
};

function useDesktopAgents(intervalMs = 1500): ReadonlyArray<DesktopHyprnavAgent> | null {
  const [agents, setAgents] = useState<ReadonlyArray<DesktopHyprnavAgent> | null>(null);
  useEffect(() => {
    const list = window.desktopBridge?.listHyprnavAgents;
    if (typeof list !== "function") {
      return;
    }
    let cancelled = false;
    const tick = () => {
      list()
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

function AgentPortal({ agent, onClose }: { agent: DesktopHyprnavAgent; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shownTarget, setShownTarget] = useState<string | null>(null);
  const target = agent.current_target;

  useEffect(() => {
    if (!target || target === shownTarget) {
      return;
    }
    let cancelled = false;
    const open = async () => {
      try {
        await window.desktopBridge?.requestHyprnavScreencast?.({ address: target });
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const previous = streamRef.current;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        if (previous) for (const track of previous.getTracks()) track.stop();
        setShownTarget(target);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void open();
    return () => {
      cancelled = true;
    };
  }, [target, shownTarget]);

  useEffect(
    () => () => {
      const stream = streamRef.current;
      if (stream) for (const track of stream.getTracks()) track.stop();
    },
    [],
  );

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
  const visual = STATE_VISUALS[agent.state] ?? STATE_VISUALS.idle!;
  const goThere = useCallback(() => {
    void window.desktopBridge?.gotoHyprnavAgent?.({
      env: agent.environment_id,
      slot: agent.slot_index,
    });
  }, [agent.environment_id, agent.slot_index]);
  const canWatch = Boolean(agent.current_target) && agent.state !== "finished";
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
          onClick={() => setWatching((value) => !value)}
        >
          <Eye className="size-3" />
          {watching ? "Watching" : "Watch"}
        </Button>
        <Button size="xs" variant="ghost" onClick={goThere}>
          <MoveRight className="size-3" />
          Go there
        </Button>
      </div>
      {watching && agent.current_target ? (
        <div className="mt-2">
          <AgentPortal agent={agent} onClose={() => setWatching(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** Returns null when the bridge is absent (browser build, other platforms) or nothing is registered. */
export function DesktopAgentsSection() {
  const agents = useDesktopAgents();
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
