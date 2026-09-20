"use client";

import type { ScopedThreadRef } from "@t3tools/contracts";
import { PanelRightIcon, PictureInPicture2, XIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useThreadPreviewState } from "~/previewStateStore";
import type { PreviewMiniPlayerPosition, PreviewMiniPlayerSize } from "~/previewMiniPlayerStore";
import { selectThreadPreviewMiniPlayer, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";

import { FloatingMiniPlayerShell } from "./FloatingMiniPlayerShell";
import { previewBridge } from "./previewBridge";
import {
  PREVIEW_MINI_PLAYER_DEFAULT_SIZE,
  PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX,
} from "./previewMiniPlayerLayout";

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly tabId: string;
  readonly bottomInset: number;
}

export function ThreadPreviewMiniPlayer({ threadRef, tabId, bottomInset }: Props) {
  const [defaultLayoutVersion, setDefaultLayoutVersion] = useState("");
  const miniPlayer = usePreviewMiniPlayerStore((state) =>
    selectThreadPreviewMiniPlayer(state.byThreadKey, threadRef),
  );
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = previewState.sessions[tabId] ?? null;
  const runtimeTabId = previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId);
  const desktopOverlay = previewState.desktopByTabId[tabId] ?? null;
  const position = miniPlayer?.tabId === tabId ? miniPlayer.position : null;
  const size =
    miniPlayer?.tabId === tabId && miniPlayer.size
      ? miniPlayer.size
      : PREVIEW_MINI_PLAYER_DEFAULT_SIZE;

  const close = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
  };

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
  };

  const toggleNativePictureInPicture = () => {
    if (!previewBridge) return;
    const operation = desktopOverlay?.pictureInPicture
      ? previewBridge.pictureInPicture.close
      : previewBridge.pictureInPicture.open;
    void operation(runtimeTabId).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to update popped-out preview",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  const onMove = useCallback(
    (next: PreviewMiniPlayerPosition) => {
      usePreviewMiniPlayerStore.getState().move(threadRef, tabId, next);
    },
    [tabId, threadRef],
  );
  const onResize = useCallback(
    (next: PreviewMiniPlayerSize) => {
      usePreviewMiniPlayerStore.getState().resize(threadRef, tabId, next);
    },
    [tabId, threadRef],
  );

  if (!snapshot || miniPlayer?.tabId !== tabId) return null;

  return (
    <FloatingMiniPlayerShell
      ariaLabel="Floating browser preview"
      dataAttributes={{ "data-preview-mini-player": tabId }}
      position={position}
      size={size}
      bottomInset={bottomInset}
      onMove={onMove}
      onResize={onResize}
      onDefaultLayoutChange={setDefaultLayoutVersion}
      resizeLabel="Resize floating preview"
      actions={
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Open preview in right panel"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={openInPanel}
                />
              }
            >
              <PanelRightIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Open in right panel</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={desktopOverlay?.pictureInPicture ? "secondary" : "ghost"}
                  size="icon-xs"
                  aria-label={
                    desktopOverlay?.pictureInPicture
                      ? "Close popped-out preview"
                      : "Pop preview into separate window"
                  }
                  disabled={!desktopOverlay?.hasWebContents}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={toggleNativePictureInPicture}
                />
              }
            >
              <PictureInPicture2 />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {desktopOverlay?.pictureInPicture
                ? "Close separate window"
                : "Pop into separate window"}
            </TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close floating preview"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={close}
                />
              }
            >
              <XIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Close floating preview</TooltipPopup>
          </Tooltip>
        </>
      }
    >
      <div className="absolute inset-0 z-[47] rounded-xl bg-muted shadow-2xl/35" />
      <BrowserSurfaceSlot
        tabId={runtimeTabId}
        visible={Boolean(desktopOverlay?.hasWebContents)}
        cornerRadius={12}
        zIndex={PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX}
        fitSourceContent
        layoutVersion={
          position
            ? `${position.x}:${position.y}`
            : `initial:${bottomInset}:${defaultLayoutVersion}`
        }
        className="absolute inset-0"
      />
      {!desktopOverlay?.hasWebContents ? (
        <div className="pointer-events-none absolute inset-0 z-[49] flex items-center justify-center rounded-xl bg-muted text-xs text-muted-foreground">
          Reconnecting preview…
        </div>
      ) : null}
    </FloatingMiniPlayerShell>
  );
}
