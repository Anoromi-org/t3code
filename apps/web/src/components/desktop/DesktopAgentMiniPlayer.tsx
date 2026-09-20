"use client";

/**
 * A floating live view of the window a desktop (computer-use) agent is working
 * on, opened by DesktopAgentMiniPlayerHost without the user clicking anything.
 *
 * The frames arrive as a `multipart/x-mixed-replace` JPEG stream the browser
 * decodes for free in an `<img>`; hyprnav captures them, the server only pipes
 * them (see apps/server/src/hyprnavFrames.ts). Nothing here holds a MediaStream
 * or a portal session, so the view costs no share-picker round trip and works
 * the same in Electron and in a browser on the same machine.
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

  const framesUrl = useMemo(() => {
    if (!address) return null;
    try {
      return resolvePrimaryEnvironmentHttpUrl("/api/hyprnav/frames", { address });
    } catch {
      return null;
    }
  }, [address]);

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
        <img
          src={framesUrl}
          alt=""
          className="absolute inset-0 size-full object-contain bg-black"
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
