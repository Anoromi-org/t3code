"use client";

import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import { MoveRight, PanelRightIcon, PictureInPicture2, XIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import {
  findActiveBrowserRecordingRuntimeTabId,
  useActiveBrowserRecordingTabIds,
} from "~/browser/browserRecording";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import type { BrowserViewportResizeDirection } from "~/browser/browserViewportLayout";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useDesktopAgentMiniPlayerStore } from "~/desktopAgentMiniPlayerStore";
import { desktopAgentStateVisual, hyprnavClient, useDesktopAgents } from "~/desktopAgentsStore";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";
import { cn } from "~/lib/utils";
import { useThreadPreviewState } from "~/previewStateStore";
import {
  type PreviewMiniPlayerSize,
  type PreviewMiniPlayerSource,
  type PreviewMiniPlayerState,
  previewMiniPlayerSourceKey,
  usePreviewMiniPlayerStore,
} from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useDeviceState } from "~/state/device";

import { HyprnavVideoView } from "../desktop/HyprnavVideoView";
import { DeviceStreamView } from "../device/DeviceStreamView";
import type { DeviceScreenSize } from "@t3tools/client-runtime/device/stream";
import { previewBridge } from "./previewBridge";
import {
  clampPreviewMiniPlayerPosition,
  NO_PREVIEW_MINI_PLAYER_OBSTACLES,
  PREVIEW_MINI_PLAYER_CORNER_RADIUS,
  PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX,
  type PreviewMiniPlayerFrame,
  type PreviewMiniPlayerObstacles,
  resizePreviewMiniPlayer,
  resolveDesktopAgentMiniPlayerSourceSize,
  resolveDeviceMiniPlayerCornerRadius,
  resolveDeviceMiniPlayerSourceSize,
  resolvePreviewMiniPlayerFrame,
  resolvePreviewMiniPlayerSourceSize,
} from "./previewMiniPlayerLayout";

interface PointerGesture {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly frame: PreviewMiniPlayerFrame;
  readonly direction: BrowserViewportResizeDirection | null;
}

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly miniPlayer: PreviewMiniPlayerState;
  /** The docked composer overlay; null while the composer floats mid-screen. */
  readonly composerOverlayElement: HTMLElement | null;
}

interface Layout {
  readonly container: PreviewMiniPlayerSize;
  readonly obstacles: PreviewMiniPlayerObstacles;
}

const sameLayout = (a: Layout, b: Layout) =>
  a.container.width === b.container.width &&
  a.container.height === b.container.height &&
  (a.obstacles.composer === b.obstacles.composer ||
    (a.obstacles.composer !== null &&
      b.obstacles.composer !== null &&
      a.obstacles.composer.left === b.obstacles.composer.left &&
      a.obstacles.composer.right === b.obstacles.composer.right &&
      a.obstacles.composer.height === b.obstacles.composer.height));

/**
 * Measures the chat column and the composer in the column's coordinates. The
 * composer's columns come from its centered stack, not the full-width overlay,
 * so the margins beside it stay open to the player.
 */
function measureLayout(container: HTMLElement, composerOverlay: HTMLElement | null): Layout {
  const containerRect = container.getBoundingClientRect();
  const stackRect = composerOverlay
    ?.querySelector('[data-chat-composer-stack="true"]')
    ?.getBoundingClientRect();
  const overlayRect = composerOverlay?.getBoundingClientRect();
  return {
    container: { width: container.clientWidth, height: container.clientHeight },
    obstacles: {
      composer:
        overlayRect && stackRect && overlayRect.height > 0
          ? {
              left: Math.floor(stackRect.left - containerRect.left),
              right: Math.ceil(stackRect.right - containerRect.left),
              height: Math.ceil(overlayRect.height),
            }
          : null,
    },
  };
}

const frameCornerRadius = () => PREVIEW_MINI_PLAYER_CORNER_RADIUS;

// Invisible grab zones straddling each edge; the cursor is the only affordance.
const RESIZE_HANDLES: ReadonlyArray<{
  readonly direction: BrowserViewportResizeDirection;
  readonly className: string;
}> = [
  { direction: "north", className: "inset-x-0 -top-1 h-2 cursor-ns-resize" },
  { direction: "south", className: "inset-x-0 -bottom-1 h-2 cursor-ns-resize" },
  { direction: "west", className: "inset-y-0 -left-1 w-2 cursor-ew-resize" },
  { direction: "east", className: "inset-y-0 -right-1 w-2 cursor-ew-resize" },
  { direction: "northwest", className: "-left-2 -top-2 size-4 cursor-nwse-resize" },
  { direction: "northeast", className: "-right-2 -top-2 size-4 cursor-nesw-resize" },
  { direction: "southwest", className: "-bottom-2 -left-2 size-4 cursor-nesw-resize" },
  { direction: "southeast", className: "-bottom-2 -right-2 size-4 cursor-nwse-resize" },
];

/** Floats the thread's browser tab, device stream or desktop agent's window over chat. */
export function ThreadPreviewMiniPlayer({ threadRef, miniPlayer, composerOverlayElement }: Props) {
  const { source } = miniPlayer;
  switch (source.kind) {
    case "browser":
      return (
        <BrowserMiniPlayer
          key={source.tabId}
          threadRef={threadRef}
          tabId={source.tabId}
          miniPlayer={miniPlayer}
          composerOverlayElement={composerOverlayElement}
        />
      );
    case "device":
      return (
        <DeviceMiniPlayer
          key={previewMiniPlayerSourceKey(source)}
          threadRef={threadRef}
          source={source}
          miniPlayer={miniPlayer}
          composerOverlayElement={composerOverlayElement}
        />
      );
    case "desktop-agent":
      return (
        <DesktopAgentMiniPlayer
          key={previewMiniPlayerSourceKey(source)}
          threadRef={threadRef}
          source={source}
          miniPlayer={miniPlayer}
          composerOverlayElement={composerOverlayElement}
        />
      );
  }
}

function BrowserMiniPlayer({
  threadRef,
  tabId,
  miniPlayer,
  composerOverlayElement,
}: Props & { readonly tabId: string }) {
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = previewState.sessions[tabId] ?? null;
  const runtimeTabId = previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const recording =
    recordingTabIds.has(runtimeTabId) ||
    findActiveBrowserRecordingRuntimeTabId(threadRef, tabId) !== null;
  const desktopOverlay = previewState.desktopByTabId[tabId] ?? null;
  const fittedSourceContent = useBrowserSurfaceStore(
    (state) => state.byTabId[runtimeTabId]?.fittedSourceContent ?? null,
  );
  const sourceSize = resolvePreviewMiniPlayerSourceSize(
    snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT,
    fittedSourceContent,
    desktopOverlay?.zoomFactor ?? 1,
  );

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

  if (!snapshot) return null;

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      composerOverlayElement={composerOverlayElement}
      label="Floating browser preview"
      recording={recording}
      onOpenInPanel={openInPanel}
      pillActions={
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
      }
    >
      {(frame) => (
        <>
          <BrowserSurfaceSlot
            tabId={runtimeTabId}
            visible={Boolean(desktopOverlay?.hasWebContents)}
            cornerRadius={PREVIEW_MINI_PLAYER_CORNER_RADIUS}
            zIndex={PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX}
            fitSourceContent
            layoutVersion={`${frame.x}:${frame.y}`}
            className="absolute inset-0"
          />
          {!desktopOverlay?.hasWebContents ? (
            <div className="pointer-events-none absolute inset-0 z-[49] flex items-center justify-center rounded-[inherit] bg-muted text-xs text-muted-foreground">
              Reconnecting preview…
            </div>
          ) : null}
        </>
      )}
    </MiniPlayerShell>
  );
}

function DeviceMiniPlayer({
  threadRef,
  source,
  miniPlayer,
  composerOverlayElement,
}: Props & { readonly source: Extract<PreviewMiniPlayerSource, { kind: "device" }> }) {
  const { state: deviceState } = useDeviceState(threadRef.environmentId);
  const [screen, setScreen] = useState<DeviceScreenSize | null>(null);
  const sourceSize = resolveDeviceMiniPlayerSourceSize(source.platform, screen);
  const device = deviceState.devices.find(
    (entry) => entry.hostId === source.hostId && entry.id === source.deviceId,
  );
  const hostLabel =
    deviceState.hosts.find((host) => host.id === source.hostId)?.label ?? "Device host";
  const cornerRadius = useCallback(
    (player: PreviewMiniPlayerSize) => resolveDeviceMiniPlayerCornerRadius(source.platform, player),
    [source.platform],
  );

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openDevice(threadRef, {
      hostId: source.hostId,
      deviceId: source.deviceId,
      platform: source.platform,
      name: source.name,
    });
  };

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      composerOverlayElement={composerOverlayElement}
      label="Floating device preview"
      onOpenInPanel={openInPanel}
      cornerRadius={cornerRadius}
    >
      {() => (
        // The stream is DOM, so it takes the band the browser's native webview would.
        <div
          className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
          style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
        >
          <DeviceStreamView
            environmentId={threadRef.environmentId}
            platform={source.platform}
            deviceId={source.deviceId}
            hostId={source.hostId}
            deviceName={device?.name ?? source.name}
            deviceDescription={`${hostLabel} · ${device?.version ?? source.platform}`}
            visible
            onScreen={setScreen}
          />
        </div>
      )}
    </MiniPlayerShell>
  );
}

/**
 * Capture width tiers the daemon knows. Asking for an arbitrary width would
 * give every player its own encoder; two players that agree on a tier share one.
 */
const DESKTOP_AGENT_CAPTURE_WIDTH_TIERS = [320, 640, 960] as const;
/** Frames per second asked of the daemon; a still window sends none of them. */
const DESKTOP_AGENT_FRAMES_FPS = 8;

function desktopAgentCaptureWidthTier(wanted: number): number {
  return DESKTOP_AGENT_CAPTURE_WIDTH_TIERS.find((tier) => tier >= wanted) ?? 960;
}

/**
 * The window a hyprnav desktop agent is acting on, streamed over the local
 * server's loopback frames route (apps/server/src/hyprnavFrames.ts): WebCodecs
 * video where the browser and daemon agree on a codec, multipart JPEG
 * otherwise. DesktopAgentMiniPlayerHost opens and closes it.
 */
function DesktopAgentMiniPlayer({
  threadRef,
  source,
  miniPlayer,
  composerOverlayElement,
}: Props & { readonly source: Extract<PreviewMiniPlayerSource, { kind: "desktop-agent" }> }) {
  const { agents } = useDesktopAgents();
  const agent = agents?.find((candidate) => candidate.agent_id === source.agentId) ?? null;
  const [frameSize, setFrameSize] = useState<PreviewMiniPlayerSize | null>(null);
  const sourceSize = resolveDesktopAgentMiniPlayerSourceSize(frameSize);

  if (!agent) return null;
  const visual = desktopAgentStateVisual(agent.state);

  // Closing by hand, or moving to the panel, suppresses this agent until its
  // state changes; otherwise the host would float it again on the next update.
  const dismiss = () => {
    useDesktopAgentMiniPlayerStore.getState().dismiss(agent.agent_id, agent.state);
    usePreviewMiniPlayerStore.getState().close(threadRef);
  };
  const openInPanel = () => {
    dismiss();
    useRightPanelStore.getState().open(threadRef, "agents");
  };

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      composerOverlayElement={composerOverlayElement}
      label={`Live view of ${agent.label}`}
      onOpenInPanel={openInPanel}
      onClose={dismiss}
      pillActions={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Go to this agent's frame"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void hyprnavClient?.goto(agent.environment_id, agent.slot_index)}
              />
            }
          >
            <MoveRight />
          </TooltipTrigger>
          <TooltipPopup side="top">Go there</TooltipPopup>
        </Tooltip>
      }
    >
      {(frame) => (
        <div
          className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
          style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
        >
          <DesktopAgentFrames
            address={source.address}
            // Twice the CSS width covers HiDPI and a little resizing without
            // renegotiating the stream.
            captureWidth={desktopAgentCaptureWidthTier(frame.width * 2)}
            label={`Live view of ${agent.label}`}
            onFrameSize={setFrameSize}
          />
          <div className="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-3rem)] items-center gap-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white">
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", visual.dotClass)} />
            <span className="min-w-0 truncate font-medium">{agent.label}</span>
            <span className="shrink-0 text-white/70">{visual.label}</span>
          </div>
        </div>
      )}
    </MiniPlayerShell>
  );
}

/** Keyed on the capture tier, not the pixel width, so resizing rarely reconnects. */
function DesktopAgentFrames({
  address,
  captureWidth,
  label,
  onFrameSize,
}: {
  readonly address: string;
  readonly captureWidth: number;
  readonly label: string;
  readonly onFrameSize: (size: PreviewMiniPlayerSize) => void;
}) {
  const url = useMemo(() => {
    try {
      return resolvePrimaryEnvironmentHttpUrl("/api/hyprnav/frames", {
        address,
        max_width: String(captureWidth),
        max_fps: String(DESKTOP_AGENT_FRAMES_FPS),
        // The agent looks at its dialog when it has one, so the view follows.
        follow: "transient",
      });
    } catch {
      return null;
    }
  }, [address, captureWidth]);
  return (
    <HyprnavVideoView
      url={url}
      label={label}
      showStats={import.meta.env.DEV}
      onFrameSize={onFrameSize}
    />
  );
}

/**
 * The frame, drag/resize gestures, and hover pill shared by every floating
 * source. Native clipping and the DOM frame use the same radius so their
 * separately composited edges stay aligned.
 */
function MiniPlayerShell({
  threadRef,
  miniPlayer,
  sourceSize,
  composerOverlayElement,
  label,
  onOpenInPanel,
  onClose,
  pillActions,
  recording = false,
  cornerRadius = frameCornerRadius,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly miniPlayer: PreviewMiniPlayerState;
  readonly sourceSize: PreviewMiniPlayerSize;
  readonly composerOverlayElement: HTMLElement | null;
  readonly label: string;
  readonly onOpenInPanel: () => void;
  /** Replaces the plain close, e.g. to remember that the user dismissed it. */
  readonly onClose?: () => void;
  readonly pillActions?: ReactNode;
  readonly recording?: boolean;
  /** The clip radius for a given frame; the pill stays inside the curve. */
  readonly cornerRadius?: (frame: PreviewMiniPlayerSize) => number;
  readonly children: (frame: PreviewMiniPlayerFrame) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<PointerGesture | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const container = layout?.container ?? null;
  const obstacles = layout?.obstacles ?? NO_PREVIEW_MINI_PLAYER_OBSTACLES;
  const sourceKey = previewMiniPlayerSourceKey(miniPlayer.source);
  const frame = container
    ? resolvePreviewMiniPlayerFrame({
        width: miniPlayer.width,
        position: miniPlayer.position,
        source: sourceSize,
        container,
        obstacles,
      })
    : null;

  const radius = frame ? cornerRadius(frame) : PREVIEW_MINI_PLAYER_CORNER_RADIUS;
  // Inside a wide curve the default 8px inset would land on the clipped-away corner.
  const pillInset = Math.max(8, Math.round(radius * 0.55));

  const close =
    onClose ??
    (() => {
      usePreviewMiniPlayerStore.getState().close(threadRef);
    });

  // The composer grows on its own (drafts, banners), so it is observed alongside the column.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      const next = measureLayout(element, composerOverlayElement);
      setLayout((current) => (current && sameLayout(current, next) ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (composerOverlayElement) observer.observe(composerOverlayElement);
    return () => observer.disconnect();
  }, [composerOverlayElement]);

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    direction: BrowserViewportResizeDirection | null,
  ) => {
    if (event.button !== 0 || !frame) return;
    gestureRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame,
      direction,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || !container) return;
    const delta = { x: event.clientX - gesture.pointerX, y: event.clientY - gesture.pointerY };
    const store = usePreviewMiniPlayerStore.getState();
    if (gesture.direction === null) {
      store.move(
        threadRef,
        sourceKey,
        clampPreviewMiniPlayerPosition(
          { x: gesture.frame.x + delta.x, y: gesture.frame.y + delta.y },
          container,
          gesture.frame,
          obstacles,
        ),
      );
      return;
    }
    const next = resizePreviewMiniPlayer({
      start: gesture.frame,
      direction: gesture.direction,
      delta,
      source: sourceSize,
      container,
      obstacles,
    });
    store.resize(threadRef, sourceKey, next.width);
    store.move(threadRef, sourceKey, { x: next.x, y: next.y });
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0">
      {frame ? (
        <section
          aria-label={label}
          data-preview-mini-player={sourceKey}
          className="pointer-events-none absolute select-none"
          style={{
            left: frame.x,
            top: frame.y,
            width: frame.width,
            height: frame.height,
            borderRadius: radius,
          }}
        >
          <div
            className="group pointer-events-auto absolute z-[49] size-3"
            style={{ right: pillInset, top: pillInset }}
          >
            <div
              role={recording ? "status" : undefined}
              aria-label={recording ? "Recording preview" : undefined}
              aria-hidden={!recording}
              className="absolute right-0 top-0 size-2 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
            >
              <span
                className={cn(
                  "block size-2 rounded-full shadow-sm ring-1 ring-background/70",
                  recording ? "bg-red-500 motion-safe:animate-status-pulse" : "bg-foreground/25",
                )}
              />
            </div>
            <div
              className="pointer-events-none absolute right-0 top-0 flex h-8 cursor-grab items-center gap-0.5 rounded-lg border border-border/80 bg-popover/92 p-0.5 opacity-0 shadow-lg/20 backdrop-blur-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 active:cursor-grabbing"
              onPointerDown={(event) => beginGesture(event, null)}
              onPointerMove={handlePointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            >
              {recording ? (
                <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
                  <span className="size-2 rounded-full bg-red-500 motion-safe:animate-status-pulse" />
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Open preview in right panel"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={onOpenInPanel}
                    />
                  }
                >
                  <PanelRightIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">Open in right panel</TooltipPopup>
              </Tooltip>
              {pillActions}
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
            </div>
          </div>

          <div className="absolute inset-0 z-[47] rounded-[inherit] bg-muted shadow-2xl/35" />
          {children(frame)}
          <div className="pointer-events-none absolute inset-0 z-[49] rounded-[inherit] ring-1 ring-inset ring-border/80" />
          {RESIZE_HANDLES.map(({ direction, className }) => (
            <div
              key={direction}
              role="presentation"
              data-preview-mini-player-resize={direction}
              className={cn("pointer-events-auto absolute z-[49] touch-none", className)}
              onPointerDown={(event) => beginGesture(event, direction)}
              onPointerMove={handlePointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
