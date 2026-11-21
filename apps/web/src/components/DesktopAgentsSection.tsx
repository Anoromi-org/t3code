/**
 * "Watch" opens a live PipeWire view of an agent's window with no share
 * picker: the desktop pre-answers the portal picker with the window address
 * before calling getDisplayMedia.
 */
import type { DesktopHyprnavAgent } from "@t3tools/contracts";
import { T, useGT, useMessages, Var } from "gt-react";
import { Eye, EyeOff, Monitor, MoveRight, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import {
  desktopAgentStateVisual,
  hyprnavClient,
  liveAgents,
  useDesktopAgents,
} from "../desktopAgentsStore";

/** The Watch view: the agent's window as a portal MediaStream. */
function AgentPortal({
  stream,
  error,
  onClose,
}: {
  stream: MediaStream | null;
  error: string | null;
  onClose: () => void;
}) {
  const gt = useGT();
  const videoRef = useRef<HTMLVideoElement>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- attaches the MediaStream to the video element
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
          <T>
            Live view unavailable: <Var>{error}</Var>
          </T>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-1.5 right-1.5 rounded bg-black/60 p-1 text-white/80 hover:text-white"
        aria-label={gt("Stop watching")}
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
  const gt = useGT();
  const visual = desktopAgentStateVisual(agent.state, useMessages());
  const target = agent.current_target;
  const goThere = () => {
    void hyprnavClient?.goto(agent.environment_id, agent.slot_index);
  };
  const canWatch = Boolean(target) && agent.state !== "finished";

  /** Bumped on every start and stop, so a capture that resolves late is dropped. */
  const requestRef = useRef(0);

  const stopStream = () => {
    requestRef.current += 1;
    const current = streamRef.current;
    streamRef.current = null;
    setStream(null);
    if (current) for (const track of current.getTracks()) track.stop();
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops the portal capture tracks on unmount
  useEffect(() => stopStream, [stopStream]);

  /**
   * Not awaited: awaiting spends the click's transient user activation and
   * getDisplayMedia fails with NotAllowedError. Posting on pointer-down gets
   * the pre-answer (valid 15 s) on disk before the click handler runs.
   */
  const preAnswer = () => {
    if (!target || watching) return;
    void hyprnavClient?.screencast(target);
  };

  const toggleWatch = () => {
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
    requestRef.current += 1;
    const request = requestRef.current;
    navigator.mediaDevices
      .getDisplayMedia({ video: true, audio: false })
      .then((next) => {
        if (request !== requestRef.current) {
          for (const track of next.getTracks()) track.stop();
          return;
        }
        streamRef.current = next;
        setStream(next);
      })
      .catch((cause: unknown) => {
        if (request !== requestRef.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", visual.dotClass)} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{agent.label}</span>
        <span className="text-xs text-muted-foreground">{visual.label}</span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <Monitor aria-hidden className="size-3" />
        <span className="truncate">
          <T>
            frame on workspace <Var>{agent.workspace_id}</Var>
          </T>
          {agent.last_action ? ` · ${agent.last_action}` : ""}
          {agent.action_count > 0
            ? ` · ${gt("{count, plural, one {{count} action} other {{count} actions}}", { count: agent.action_count })}`
            : ""}
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
          {watching ? gt("Watching") : gt("Watch", { $context: "verb, opens a live view" })}
        </Button>
        <Button size="xs" variant="ghost" onClick={goThere}>
          <MoveRight className="size-3" />
          <T>Go there</T>
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
        <span className="text-xs font-medium text-muted-foreground">
          <T>Desktop agents</T>
        </span>
        {connected ? (
          <span className="text-xs text-muted-foreground">{agents.length}</span>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex items-center gap-1 text-xs text-warning">
                  <WifiOff aria-hidden className="size-3" />
                  <T>disconnected</T>
                </span>
              }
            />
            <TooltipPopup side="top">
              <T>Lost the connection to hyprnav; this list may be stale.</T>
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
