import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { m } from "~/i18n/messages";
import { FILL_PREVIEW_VIEWPORT, type ScopedThreadRef } from "@t3tools/contracts";
import { previewPdfAssetUrl } from "@t3tools/shared/preview";
import { useEnvironmentHttpBaseUrl } from "~/state/environments";
import { MoveRight, PanelRightIcon, PictureInPicture2, XIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { T, useGT, useMessages } from "gt-react";
import { create } from "zustand";
import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import { useChatCanvas } from "../chat/ChatCanvasContext";
import type { ChatCanvasPreview } from "../chat/chatCanvasLayout";
import { BrowserSurfaceSlot } from "~/browser/BrowserSurfaceSlot";
import {
  findActiveBrowserRecordingRuntimeTabId,
  useActiveBrowserRecordingTabIds,
} from "~/browser/browserRecording";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import type { BrowserViewportResizeDirection } from "~/browser/browserViewportLayout";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { rendersServerTabNatively } from "~/browser/previewRuntime";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { type ServerBrowserHandle, ServerBrowserSurface } from "~/browser/ServerBrowserSurface";
import {
  closeServerPictureInPicture,
  openServerPictureInPicture,
  serverPictureInPictureKey,
  supportsServerPictureInPicture,
  useServerPictureInPictureKey,
} from "~/browser/serverPictureInPicture";
import { useBrowserLayoutZoomFactor } from "~/browser/useBrowserLayoutZoomFactor";
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
  browserMiniPlayerSource,
  previewMiniPlayerSourceKey,
  usePreviewMiniPlayerStore,
} from "~/previewMiniPlayerStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { useDeviceState } from "~/state/device";

import { HyprnavVideoView } from "../desktop/HyprnavVideoView";
import { DeviceStreamView } from "../device/DeviceStreamView";
import type { DeviceScreenSize } from "@t3tools/client-runtime/device/stream";
import { Atom } from "effect/reactivity";
import { deviceScreenKey, deviceStreamScreenAtom } from "../device/deviceStreamSession";
import type { PreviewStreamViewport } from "@t3tools/client-runtime/preview/server-browser-stream";
import { previewBridge } from "./previewBridge";
import { PreviewUnreachable } from "./PreviewUnreachable";
import { showPreviewPopup } from "./showPreviewPopup";
import {
  type PreviewMiniPlayerGesture,
  settlePreviewMiniPlayerResize,
  stepPreviewMiniPlayerGesture,
} from "./previewMiniPlayerGesture";
import {
  PREVIEW_MINI_PLAYER_CORNER_RADIUS,
  PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX,
  type PreviewMiniPlayerFrame,
  resolveDesktopAgentMiniPlayerSourceSize,
  resolveDeviceMiniPlayerCornerRadius,
  resolveDeviceMiniPlayerSourceSize,
  resolvePreviewMiniPlayerSourceSize,
} from "./previewMiniPlayerLayout";

interface Props {
  readonly threadRef: ScopedThreadRef;
  readonly miniPlayer: PreviewMiniPlayerState;
}

const frameCornerRadius = () => PREVIEW_MINI_PLAYER_CORNER_RADIUS;

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

// What the stream reports about its source. It lives outside the player so the
// chat canvas lays out the frame from the same source size the player uses. One
// slot is enough, since only the shown thread renders a player, and it keeps the
// store from collecting an entry for every tab a session ever streamed.
const useStreamedSourceSize = create<{
  readonly key: string;
  readonly viewport: PreviewStreamViewport;
} | null>(() => null);

// The source size a resize in progress lays the frame out from, so a source that changes shape
// under a held handle cannot resize the player by itself. Same single slot as above.
const useHeldSourceSize = create<{
  readonly key: string;
  readonly source: PreviewMiniPlayerSize;
} | null>(() => null);

// Fork: the frame size a desktop agent's stream decoded, for the same reason. Same single slot.
const useDesktopAgentFrameSize = create<{
  readonly key: string;
  readonly size: PreviewMiniPlayerSize;
} | null>(() => null);

const NO_DEVICE_SCREEN_ATOM = Atom.make<DeviceScreenSize | null>(null).pipe(
  Atom.withLabel("device-stream-screen:none"),
);

const streamedSourceKey = (threadRef: ScopedThreadRef, sourceKey: string) =>
  `${scopedThreadKey(threadRef)}\u0000${sourceKey}`;

// The mini player's device stream view, named so the canvas can read the
// screen size that view reports.
const miniPlayerDeviceViewId = (
  threadRef: ScopedThreadRef,
  source: Extract<PreviewMiniPlayerSource, { kind: "device" }>,
) =>
  `preview-mini-player\u0000${scopedThreadKey(threadRef)}\u0000${deviceScreenKey(threadRef.environmentId, source.hostId, source.deviceId)}`;

function useBrowserMiniPlayerSource(threadRef: ScopedThreadRef | null, tabId: string | null) {
  const previewState = useThreadPreviewState(threadRef);
  const snapshot = tabId === null ? null : (previewState.sessions[tabId] ?? null);
  const runtimeTabId =
    threadRef && tabId !== null
      ? previewRuntimeTabId(threadRef, previewState.serverEpoch, tabId)
      : null;
  const desktopOverlay = tabId === null ? null : (previewState.desktopByTabId[tabId] ?? null);
  const layoutZoomFactor = useBrowserLayoutZoomFactor(desktopOverlay?.zoomFactor ?? 1);
  const fittedSourceContent = useBrowserSurfaceStore((state) =>
    runtimeTabId === null ? null : (state.byTabId[runtimeTabId]?.fittedSourceContent ?? null),
  );
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const serverTab =
    threadRef !== null &&
    snapshot?.runtime === "server" &&
    !rendersServerTabNatively(threadRef.environmentId, primaryEnvironmentId, snapshot);
  const streamViewport = useStreamedSourceSize((state) =>
    threadRef &&
    tabId !== null &&
    state?.key ===
      streamedSourceKey(threadRef, previewMiniPlayerSourceKey(browserMiniPlayerSource(tabId)))
      ? state.viewport
      : null,
  );
  const sourceSize: PreviewMiniPlayerSize =
    serverTab && streamViewport
      ? streamViewport
      : resolvePreviewMiniPlayerSourceSize(
          snapshot?.viewport ?? FILL_PREVIEW_VIEWPORT,
          fittedSourceContent,
          layoutZoomFactor,
        );
  return { serverEpoch: previewState.serverEpoch, snapshot, desktopOverlay, serverTab, sourceSize };
}

/** The mini player as the chat canvas lays it out; null when no player renders. */
export function useThreadPreviewCanvasSource(
  threadRef: ScopedThreadRef | null,
  miniPlayer: PreviewMiniPlayerState | null,
): ChatCanvasPreview | null {
  const source = miniPlayer?.source ?? null;
  const browser = useBrowserMiniPlayerSource(
    threadRef,
    source?.kind === "browser" ? source.tabId : null,
  );
  const sourceKey = source ? previewMiniPlayerSourceKey(source) : null;
  const screen = useAtomValue(
    threadRef && source?.kind === "device"
      ? deviceStreamScreenAtom(miniPlayerDeviceViewId(threadRef, source))
      : NO_DEVICE_SCREEN_ATOM,
  );
  const agentFrame = useDesktopAgentFrameSize((state) =>
    threadRef && sourceKey !== null && state?.key === streamedSourceKey(threadRef, sourceKey)
      ? state.size
      : null,
  );
  const heldSource = useHeldSourceSize((state) =>
    threadRef && sourceKey !== null && state?.key === streamedSourceKey(threadRef, sourceKey)
      ? state.source
      : null,
  );
  if (!miniPlayer || !source || sourceKey === null) return null;
  if (source.kind === "browser" && !browser.snapshot) return null;
  return {
    key: sourceKey,
    width: miniPlayer.width,
    position: miniPlayer.position,
    lastInteraction: miniPlayer.lastInteraction,
    source:
      heldSource ??
      (source.kind === "browser"
        ? browser.sourceSize
        : source.kind === "desktop-agent"
          ? resolveDesktopAgentMiniPlayerSourceSize(agentFrame)
          : resolveDeviceMiniPlayerSourceSize(source.platform, screen)),
  };
}

export function ThreadPreviewMiniPlayer({ threadRef, miniPlayer }: Props) {
  const { source } = miniPlayer;
  switch (source.kind) {
    case "browser":
      return (
        <BrowserMiniPlayer
          key={source.tabId}
          threadRef={threadRef}
          tabId={source.tabId}
          miniPlayer={miniPlayer}
        />
      );
    case "device":
      return (
        <DeviceMiniPlayer
          key={previewMiniPlayerSourceKey(source)}
          threadRef={threadRef}
          source={source}
          miniPlayer={miniPlayer}
        />
      );
    case "desktop-agent":
      return (
        <DesktopAgentMiniPlayer
          key={previewMiniPlayerSourceKey(source)}
          threadRef={threadRef}
          source={source}
          miniPlayer={miniPlayer}
        />
      );
  }
}

function BrowserMiniPlayer({ threadRef, tabId, miniPlayer }: Props & { readonly tabId: string }) {
  const gt = useGT();
  const httpBaseUrl = useEnvironmentHttpBaseUrl(threadRef.environmentId);
  const { serverEpoch, snapshot, desktopOverlay, serverTab, sourceSize } =
    useBrowserMiniPlayerSource(threadRef, tabId);
  const runtimeTabId = previewRuntimeTabId(threadRef, serverEpoch, tabId);
  const recordingTabIds = useActiveBrowserRecordingTabIds();
  const recording =
    recordingTabIds.has(runtimeTabId) ||
    findActiveBrowserRecordingRuntimeTabId(threadRef, tabId) !== null;
  const serverSurfaceRef = useRef<ServerBrowserHandle | null>(null);
  const serverPictureInPicture =
    useServerPictureInPictureKey() === serverPictureInPictureKey(threadRef.threadId, tabId);
  const viewportKey = streamedSourceKey(
    threadRef,
    previewMiniPlayerSourceKey(browserMiniPlayerSource(tabId)),
  );

  const openInPanel = () => {
    usePreviewMiniPlayerStore.getState().close(threadRef);
    useRightPanelStore.getState().openBrowser(threadRef, tabId);
  };

  const toggleNativePictureInPicture = async () => {
    try {
      if (serverTab) {
        if (serverPictureInPicture) closeServerPictureInPicture();
        else
          await openServerPictureInPicture({
            ...threadRef,
            tabId,
            seed: serverSurfaceRef.current?.canvas() ?? null,
          });
      } else if (previewBridge) {
        const operation = desktopOverlay?.pictureInPicture
          ? previewBridge.pictureInPicture.close
          : previewBridge.pictureInPicture.open;
        await operation(runtimeTabId);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: serverTab
          ? gt("Unable to pop out preview")
          : gt("Unable to update popped-out preview"),
        description: thrownErrorMessage(error, m) ?? gt("An error occurred."),
      });
    }
  };

  if (!snapshot) return null;
  const pdfUrl =
    snapshot.navStatus._tag === "Success"
      ? previewPdfAssetUrl(snapshot.navStatus.url, httpBaseUrl)
      : null;
  const loadFailed = snapshot.navStatus._tag === "LoadFailed" ? snapshot.navStatus : null;
  const poppedOut = serverTab ? serverPictureInPicture : Boolean(desktopOverlay?.pictureInPicture);
  const canPopOut = serverTab
    ? poppedOut || (pdfUrl === null && supportsServerPictureInPicture())
    : true;

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label={gt("Floating browser preview")}
      recording={recording}
      onOpenInPanel={openInPanel}
      pillActions={
        canPopOut ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={poppedOut ? "secondary" : "ghost"}
                  size="icon-xs"
                  aria-label={
                    poppedOut
                      ? gt("Close popped-out preview")
                      : gt("Pop preview into separate window")
                  }
                  disabled={!serverTab && !desktopOverlay?.hasWebContents}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={toggleNativePictureInPicture}
                />
              }
            >
              <PictureInPicture2 />
            </TooltipTrigger>
            <TooltipPopup side="top">
              {poppedOut ? gt("Close separate window") : gt("Pop into separate window")}
            </TooltipPopup>
          </Tooltip>
        ) : null
      }
    >
      {(frame) =>
        serverTab ? (
          <div
            className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
            style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
          >
            <ServerBrowserSurface
              ref={serverSurfaceRef}
              environmentId={threadRef.environmentId}
              threadId={threadRef.threadId}
              tabId={tabId}
              pdfUrl={pdfUrl}
              visible
              followSize={false}
              controlPosition="bottom"
              onViewport={(viewport) =>
                useStreamedSourceSize.setState(
                  (state) =>
                    state?.key === viewportKey &&
                    state.viewport.width === viewport.width &&
                    state.viewport.height === viewport.height
                      ? state
                      : { key: viewportKey, viewport },
                  true,
                )
              }
              onPopup={(popupTabId) => showPreviewPopup(threadRef, popupTabId, "floating")}
              className="size-full"
            />
          </div>
        ) : (
          <>
            <BrowserSurfaceSlot
              tabId={runtimeTabId}
              visible={Boolean(desktopOverlay?.hasWebContents) && !loadFailed}
              cornerRadius={PREVIEW_MINI_PLAYER_CORNER_RADIUS}
              zIndex={PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX}
              fitSourceContent
              layoutVersion={`${frame.x}:${frame.y}`}
              className="absolute inset-0"
            />
            {loadFailed ? (
              <div className="pointer-events-auto absolute inset-0 z-[48] overflow-hidden rounded-[inherit]">
                <PreviewUnreachable
                  url={loadFailed.url}
                  code={loadFailed.code}
                  description={loadFailed.description}
                  onReload={() => void previewBridge?.refresh(runtimeTabId)}
                />
              </div>
            ) : !desktopOverlay?.hasWebContents ? (
              <div className="pointer-events-none absolute inset-0 z-[49] flex items-center justify-center rounded-[inherit] bg-muted text-xs text-muted-foreground">
                <T>Reconnecting preview…</T>
              </div>
            ) : null}
          </>
        )
      }
    </MiniPlayerShell>
  );
}

function DeviceMiniPlayer({
  threadRef,
  source,
  miniPlayer,
}: Props & { readonly source: Extract<PreviewMiniPlayerSource, { kind: "device" }> }) {
  const gt = useGT();
  const { state: deviceState } = useDeviceState(threadRef.environmentId);
  const viewId = miniPlayerDeviceViewId(threadRef, source);
  const screen = useAtomValue(deviceStreamScreenAtom(viewId));
  const sourceSize = resolveDeviceMiniPlayerSourceSize(source.platform, screen);
  const device = deviceState.devices.find(
    (entry) => entry.hostId === source.hostId && entry.id === source.deviceId,
  );
  const host = deviceState.hosts.find((entry) => entry.id === source.hostId);
  const hostLabel = host?.label ?? gt("Device host");
  const cornerRadius = (player: PreviewMiniPlayerSize) =>
    resolveDeviceMiniPlayerCornerRadius(source.platform, player);

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
      label={gt("Floating device preview")}
      onOpenInPanel={openInPanel}
      cornerRadius={cornerRadius}
    >
      {() => (
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
            viewId={viewId}
            serveSimOnly={host?.kind === "simlock"}
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
 * Fork: the window a hyprnav desktop agent acts on, streamed over the local server's loopback
 * frames route (apps/server/src/hyprnavFrames.ts). DesktopAgentMiniPlayerHost opens and closes it.
 */
function DesktopAgentMiniPlayer({
  threadRef,
  source,
  miniPlayer,
}: Props & { readonly source: Extract<PreviewMiniPlayerSource, { kind: "desktop-agent" }> }) {
  const gt = useGT();
  const resolveMessage = useMessages();
  const { agents } = useDesktopAgents();
  const agent = agents?.find((candidate) => candidate.agent_id === source.agentId) ?? null;
  const frameKey = streamedSourceKey(threadRef, previewMiniPlayerSourceKey(source));
  const frameSize = useDesktopAgentFrameSize((state) =>
    state?.key === frameKey ? state.size : null,
  );
  const sourceSize = resolveDesktopAgentMiniPlayerSourceSize(frameSize);
  const setFrameSize = (size: PreviewMiniPlayerSize) =>
    useDesktopAgentFrameSize.setState({ key: frameKey, size }, true);

  if (!agent) return null;
  const visual = desktopAgentStateVisual(agent.state, resolveMessage);
  const label = gt("Live view of {agent}", { agent: agent.label });

  // Closing by hand, or moving to the panel, suppresses this agent until its
  // state changes; otherwise the host would float it again on the next update.
  const dismiss = () => {
    useDesktopAgentMiniPlayerStore.getState().dismiss(agent.agent_id, agent.state);
    usePreviewMiniPlayerStore.getState().close(threadRef);
  };
  const openInPanel = () => {
    dismiss();
    useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", true);
  };

  return (
    <MiniPlayerShell
      threadRef={threadRef}
      miniPlayer={miniPlayer}
      sourceSize={sourceSize}
      label={label}
      onOpenInPanel={openInPanel}
      onClose={dismiss}
      pillActions={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={gt("Go to this agent's frame")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => void hyprnavClient?.goto(agent.environment_id, agent.slot_index)}
              />
            }
          >
            <MoveRight />
          </TooltipTrigger>
          <TooltipPopup side="top">{gt("Go there")}</TooltipPopup>
        </Tooltip>
      }
    >
      {(frame) => (
        <div
          className="pointer-events-auto absolute inset-0 overflow-hidden rounded-[inherit]"
          style={{ zIndex: PREVIEW_MINI_PLAYER_WEBVIEW_Z_INDEX }}
        >
          <HyprnavVideoView
            // Keyed on the capture tier, not the pixel width, so resizing rarely reconnects.
            // Twice the CSS width covers HiDPI and a little resizing.
            url={desktopAgentFramesUrl(
              source.address,
              desktopAgentCaptureWidthTier(frame.width * 2),
            )}
            label={label}
            showStats={import.meta.env.DEV}
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

function desktopAgentFramesUrl(address: string, captureWidth: number): string | null {
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
}

/** Match native clipping and DOM radii to align their separately composited edges. */
function MiniPlayerShell({
  threadRef,
  miniPlayer,
  sourceSize,
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
  readonly label: string;
  readonly onOpenInPanel: () => void;
  /** Replaces the plain close, e.g. to remember that the user dismissed it. */
  readonly onClose?: () => void;
  readonly pillActions?: ReactNode;
  readonly recording?: boolean;
  readonly cornerRadius?: (frame: PreviewMiniPlayerSize) => number;
  readonly children: (frame: PreviewMiniPlayerFrame) => ReactNode;
}) {
  const gt = useGT();
  const canvas = useChatCanvas();
  const gestureRef = useRef<PreviewMiniPlayerGesture | null>(null);
  const captureRef = useRef<HTMLElement | null>(null);
  // Touch toggles the pill after the tap's click so that click cannot land on the newly opened pill.
  const [pillOpen, setPillOpen] = useState(false);
  const handleTappedRef = useRef(false);
  const handleRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- document pointerdown listener closes the open pill on an outside press
  useEffect(() => {
    if (!pillOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && handleRef.current?.contains(event.target)) return;
      setPillOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [pillOpen]);
  const container = canvas?.container ?? null;
  const sourceKey = previewMiniPlayerSourceKey(miniPlayer.source);
  const heldSourceKey = streamedSourceKey(threadRef, sourceKey);
  const frame = canvas?.previewKey === sourceKey ? canvas.layout.frame : null;

  const radius = frame ? cornerRadius(frame) : PREVIEW_MINI_PLAYER_CORNER_RADIUS;
  const pillInset = Math.max(8, Math.round(radius * 0.55));

  const close =
    onClose ??
    (() => {
      usePreviewMiniPlayerStore.getState().close(threadRef);
    });
  /** Every way a gesture stops comes through here; returns the gesture it ended. */
  const finishGesture = () => {
    const gesture = gestureRef.current;
    if (!gesture) return null;
    gestureRef.current = null;
    handleTappedRef.current = false;
    const handle = captureRef.current;
    captureRef.current = null;
    if (handle?.hasPointerCapture(gesture.pointerId)) {
      handle.releasePointerCapture(gesture.pointerId);
    }
    if (gesture.direction === null) return gesture;
    useHeldSourceSize.setState((state) => (state?.key === heldSourceKey ? null : state), true);
    const settled =
      frame && container
        ? settlePreviewMiniPlayerResize({
            frame,
            direction: gesture.direction,
            held: gesture.source,
            source: sourceSize,
            container,
          })
        : null;
    if (settled) {
      usePreviewMiniPlayerStore
        .getState()
        .resize(threadRef, sourceKey, settled.width, { x: settled.x, y: settled.y });
    }
    return gesture;
  };
  const endInterruptedGesture = useEffectEvent(() => {
    finishGesture();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window blur ends a gesture whose release went to another window, and unmount ends one in progress
  useEffect(() => {
    window.addEventListener("blur", endInterruptedGesture);
    return () => {
      window.removeEventListener("blur", endInterruptedGesture);
      useHeldSourceSize.setState((state) => (state?.key === heldSourceKey ? null : state), true);
    };
  }, [heldSourceKey]);

  const beginGesture = (
    event: ReactPointerEvent<HTMLElement>,
    direction: BrowserViewportResizeDirection | null,
  ) => {
    if (event.button !== 0 || !frame) return;
    finishGesture();
    gestureRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      pointerX: event.clientX,
      pointerY: event.clientY,
      frame,
      direction,
      source: sourceSize,
      moved: false,
    };
    captureRef.current = event.currentTarget;
    if (direction !== null) {
      useHeldSourceSize.setState({ key: heldSourceKey, source: sourceSize }, true);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || !container) return;
    const step = stepPreviewMiniPlayerGesture(gesture, event, container);
    if (step.kind === "ignore") return;
    if (step.kind === "end") {
      finishGesture();
      return;
    }
    if (!gesture.moved) gestureRef.current = { ...gesture, moved: true };
    const store = usePreviewMiniPlayerStore.getState();
    if (step.kind === "move") {
      store.move(threadRef, sourceKey, step.position);
      return;
    }
    store.resize(threadRef, sourceKey, step.frame.width, { x: step.frame.x, y: step.frame.y });
  };

  const endGesture = (event: ReactPointerEvent<HTMLElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    const gesture = finishGesture();
    handleTappedRef.current =
      event.type === "pointerup" &&
      gesture?.direction === null &&
      gesture.pointerType === "touch" &&
      !gesture.moved;
  };

  // Capture can go without a release or cancel: the handle is replaced, or the platform takes it.
  const handleLostCapture = (event: ReactPointerEvent<HTMLElement>) => {
    if (
      gestureRef.current?.pointerId === event.pointerId &&
      captureRef.current === event.currentTarget
    ) {
      finishGesture();
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0">
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
            ref={handleRef}
            data-pill-open={pillOpen ? "" : undefined}
            className="group pointer-events-auto absolute z-[49] size-3 touch-none cursor-grab active:cursor-grabbing pointer-coarse:-m-2.5 pointer-coarse:size-8"
            style={{ right: pillInset, top: pillInset }}
            onPointerDown={(event) => beginGesture(event, null)}
            onPointerMove={handlePointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onLostPointerCapture={handleLostCapture}
            onClick={() => {
              if (!handleTappedRef.current) return;
              handleTappedRef.current = false;
              setPillOpen((open) => !open);
            }}
          >
            <div
              role={recording ? "status" : undefined}
              aria-label={recording ? gt("Recording preview") : undefined}
              aria-hidden={!recording}
              className="absolute right-0 top-0 size-2 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 group-data-pill-open:opacity-0 pointer-coarse:right-2.5 pointer-coarse:top-2.5"
            >
              <span
                className={cn(
                  "block size-2 rounded-full shadow-sm ring-1 ring-background/70",
                  recording
                    ? "bg-destructive motion-safe:animate-status-pulse"
                    : "bg-foreground/25",
                )}
              />
            </div>
            <div className="pointer-events-none absolute right-0 top-0 flex h-8 cursor-grab items-center gap-0.5 rounded-lg border border-border/80 bg-popover/92 p-0.5 opacity-0 shadow-lg/20 backdrop-blur-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-data-pill-open:pointer-events-auto group-data-pill-open:opacity-100 active:cursor-grabbing pointer-coarse:right-2.5 pointer-coarse:top-2.5">
              {recording ? (
                <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
                  <span className="size-2 rounded-full bg-destructive motion-safe:animate-status-pulse" />
                </span>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={gt("Open preview in right panel")}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={onOpenInPanel}
                    />
                  }
                >
                  <PanelRightIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  <T>Open in right panel</T>
                </TooltipPopup>
              </Tooltip>
              {pillActions}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={gt("Close floating preview")}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={close}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  <T>Close floating preview</T>
                </TooltipPopup>
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
              onLostPointerCapture={handleLostCapture}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
