/**
 * Desktop agents: cua MCP processes that hyprnav tracks on this machine.
 * Each one owns a frame (workspace) and reports what window it is acting on.
 * "Watch" opens a live PipeWire view of that window inside the panel, with no
 * share-picker dialog: the desktop pre-answers the portal picker with the
 * window address before calling getDisplayMedia.
 */
import type { DesktopHyprnavAgent } from "@t3tools/contracts";
import { Eye, EyeOff, Monitor, MoveRight, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import {
  DESKTOP_AGENT_STATE_VISUALS,
  hyprnavClient,
  liveAgents,
  useDesktopAgents,
} from "../desktopAgentsStore";

/**
 * One subscription per page, shared by the panel and the tab badge.
 *
 * The server pushes the registry over SSE (/api/hyprnav/events), which is fed
 * by hyprnav's event socket, so nothing polls in the steady state. Polling is
 * kept only as a fallback for when EventSource is missing or the stream keeps
 * failing to open.
 */
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
  const visual = DESKTOP_AGENT_STATE_VISUALS[agent.state] ?? DESKTOP_AGENT_STATE_VISUALS.idle!;
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
