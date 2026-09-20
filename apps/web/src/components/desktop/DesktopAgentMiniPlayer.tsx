"use client";

/**
 * A floating live view of the window a desktop (computer-use) agent is working
 * on, opened by DesktopAgentMiniPlayerHost without the user clicking anything.
 *
 * The frames arrive over one loopback HTTP stream: a damage-driven video
 * stream decoded with WebCodecs where the browser and the daemon agree on a
 * codec, and the old `multipart/x-mixed-replace` JPEG stream where they do not
 * (see HyprnavVideoView). hyprnav captures and encodes; the server only pipes
 * (apps/server/src/hyprnavFrames.ts). Nothing here holds a MediaStream or a
 * portal session, so the view costs no share-picker round trip and works the
 * same in Electron and in a browser on the same machine.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { MoveRight, XIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  selectThreadDesktopAgentMiniPlayer,
  useDesktopAgentMiniPlayerStore,
} from "~/desktopAgentMiniPlayerStore";
import { DESKTOP_AGENT_STATE_VISUALS, hyprnavClient, useDesktopAgents } from "~/desktopAgentsStore";
import { cn } from "~/lib/utils";
import { FloatingMiniPlayerShell } from "~/components/preview/FloatingMiniPlayerShell";
import { PREVIEW_MINI_PLAYER_DEFAULT_SIZE } from "~/components/preview/previewMiniPlayerLayout";
import type { PreviewMiniPlayerPosition, PreviewMiniPlayerSize } from "~/previewMiniPlayerStore";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";

import { HyprnavVideoView } from "./HyprnavVideoView";

/**
 * Capture width tiers the daemon knows (FRAMES-VIDEO-PLAN §2). Asking for an
 * arbitrary width would give every player its own encoder.
 */
const CAPTURE_WIDTH_TIERS = [320, 640, 960] as const;

const captureWidthTier = (wanted: number): number =>
  CAPTURE_WIDTH_TIERS.find((tier) => tier >= wanted) ?? CAPTURE_WIDTH_TIERS.at(-1)!;

/** Frames per second asked of the daemon; a still window sends none of them. */
const FRAMES_FPS = 8;

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly bottomInset: number;
  /** Stacks this player under the browser preview when both are open. */
  readonly topOffset?: number;
}

export function DesktopAgentMiniPlayer({ threadRef, bottomInset, topOffset }: Props) {
  const miniPlayer = useDesktopAgentMiniPlayerStore((state) =>
    selectThreadDesktopAgentMiniPlayer(state.byThreadKey, threadRef),
  );
  const { agents } = useDesktopAgents();
  const agentId = miniPlayer?.agentId ?? null;
  const agent = agents?.find((candidate) => candidate.agent_id === agentId) ?? null;
  const address = miniPlayer?.address ?? null;
  const playerWidth = (miniPlayer?.size ?? PREVIEW_MINI_PLAYER_DEFAULT_SIZE).width;

  const framesUrl = useMemo(() => {
    if (!address) return null;
    try {
      return resolvePrimaryEnvironmentHttpUrl("/api/hyprnav/frames", {
        address,
        // Twice the CSS width, so a HiDPI screen and a little resizing are
        // covered without re-negotiating; the daemon keys its pipelines by
        // width, so asking for a tier is what lets two players share one.
        max_width: String(captureWidthTier(playerWidth * 2)),
        max_fps: String(FRAMES_FPS),
        // The agent is looking at its dialog when it has one, so that is what
        // the view should show (FRAMES-VIDEO-PLAN §6).
        follow: "transient",
      });
    } catch {
      return null;
    }
  }, [address, playerWidth]);

  const onMove = useCallback(
    (next: PreviewMiniPlayerPosition) => {
      if (!agentId) return;
      useDesktopAgentMiniPlayerStore.getState().move(threadRef, agentId, next);
    },
    [agentId, threadRef],
  );
  const onResize = useCallback(
    (next: PreviewMiniPlayerSize) => {
      if (!agentId) return;
      useDesktopAgentMiniPlayerStore.getState().resize(threadRef, agentId, next);
    },
    [agentId, threadRef],
  );

  if (!miniPlayer || !agent || !framesUrl) return null;

  const visual = DESKTOP_AGENT_STATE_VISUALS[agent.state] ?? DESKTOP_AGENT_STATE_VISUALS.idle!;

  const dismiss = () => {
    useDesktopAgentMiniPlayerStore.getState().dismiss(threadRef, agent.agent_id, agent.state);
  };
  const goThere = () => {
    void hyprnavClient?.goto(agent.environment_id, agent.slot_index);
  };

  return (
    <FloatingMiniPlayerShell
      ariaLabel={`Live view of ${agent.label}`}
      dataAttributes={{ "data-desktop-agent-mini-player": agent.agent_id }}
      position={miniPlayer.position}
      size={miniPlayer.size ?? PREVIEW_MINI_PLAYER_DEFAULT_SIZE}
      bottomInset={bottomInset}
      {...(topOffset === undefined ? {} : { topOffset })}
      onMove={onMove}
      onResize={onResize}
      resizeLabel="Resize desktop agent view"
      actions={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Go to this agent's frame"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={goThere}
                />
              }
            >
              <MoveRight />
            </TooltipTrigger>
            <TooltipPopup side="top">Go there</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close desktop agent view"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={dismiss}
                />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Close live view</TooltipPopup>
          </Tooltip>
        </>
      }
    >
      <div className="absolute inset-0 z-[47] overflow-hidden rounded-xl bg-black shadow-2xl/35">
        <HyprnavVideoView
          url={framesUrl}
          label={`Live view of ${agent.label}`}
          showStats={import.meta.env.DEV}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[49] flex items-center gap-1.5 rounded-t-xl bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5 pr-12 text-xs text-white">
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            visual.dotClass,
            visual.pulse && "animate-pulse",
          )}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{agent.label}</span>
        <span className="shrink-0 text-white/70">{visual.label}</span>
      </div>
    </FloatingMiniPlayerShell>
  );
}
