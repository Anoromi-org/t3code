"use client";

/**
 * The chrome every floating mini player shares: absolute placement inside the
 * chat surface, a hover-revealed toolbar that doubles as the drag handle, a
 * corner resize grip, and clamping against the container and the composer.
 *
 * It owns no store: position and size come in, moves and resizes go out, so
 * the browser preview and the desktop-agent view can each keep their own
 * thread-scoped state without sharing a reaper.
 */
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
} from "react";

import type { PreviewMiniPlayerPosition, PreviewMiniPlayerSize } from "~/previewMiniPlayerStore";

import {
  clampPreviewMiniPlayerPosition,
  clampPreviewMiniPlayerSize,
  PREVIEW_MINI_PLAYER_EDGE_GAP,
} from "./previewMiniPlayerLayout";

interface DragState {
  readonly pointerId: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly playerX: number;
  readonly playerY: number;
}

interface ResizeState extends DragState {
  readonly width: number;
  readonly height: number;
}

interface Props {
  readonly ariaLabel: string;
  /** Extra `data-*` attributes for tests to find this player by. */
  readonly dataAttributes?: Record<string, string>;
  readonly position: PreviewMiniPlayerPosition | null;
  readonly size: PreviewMiniPlayerSize;
  readonly bottomInset: number;
  /** Pushes the default (undragged) placement down, to stack under another player. */
  readonly topOffset?: number;
  readonly onMove: (position: PreviewMiniPlayerPosition) => void;
  readonly onResize: (size: PreviewMiniPlayerSize) => void;
  /**
   * Fires with a token that changes whenever the container resizes while the
   * player still sits at its default position, for content that has to be
   * told when its layout moved without a position of its own to watch.
   */
  readonly onDefaultLayoutChange?: (version: string) => void;
  readonly resizeLabel: string;
  /** Buttons shown in the hover toolbar, left to right. */
  readonly actions: ReactNode;
  readonly children: ReactNode;
}

export function FloatingMiniPlayerShell({
  ariaLabel,
  dataAttributes,
  position,
  size,
  bottomInset,
  topOffset = 0,
  onMove,
  onResize,
  onDefaultLayoutChange,
  resizeLabel,
  actions,
  children,
}: Props) {
  const rootRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);

  useLayoutEffect(() => {
    const clampAndMove = () => {
      const root = rootRef.current;
      const parent = root?.offsetParent;
      if (!root || !(parent instanceof HTMLElement)) return;
      const nextSize = clampPreviewMiniPlayerSize(
        { width: root.offsetWidth, height: root.offsetHeight },
        { width: parent.clientWidth, height: parent.clientHeight },
        bottomInset,
      );
      onResize(nextSize);
      if (!position) {
        onDefaultLayoutChange?.(`${parent.clientWidth}:${parent.clientHeight}`);
        return;
      }
      onMove(
        clampPreviewMiniPlayerPosition(
          position,
          { width: parent.clientWidth, height: parent.clientHeight },
          nextSize,
          bottomInset,
        ),
      );
    };
    clampAndMove();
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (!root || !(parent instanceof HTMLElement) || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(clampAndMove);
    observer.observe(root);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [bottomInset, onDefaultLayoutChange, onMove, onResize, position]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (!root || !(parent instanceof HTMLElement)) return;
    const rootRect = root.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      playerX: rootRect.left - parentRect.left,
      playerY: rootRect.top - parentRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (!drag || drag.pointerId !== event.pointerId || !root || !(parent instanceof HTMLElement)) {
      return;
    }
    onMove(
      clampPreviewMiniPlayerPosition(
        {
          x: drag.playerX + event.clientX - drag.pointerX,
          y: drag.playerY + event.clientY - drag.pointerY,
        },
        { width: parent.clientWidth, height: parent.clientHeight },
        { width: root.offsetWidth, height: root.offsetHeight },
        bottomInset,
      ),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (!root || !(parent instanceof HTMLElement)) return;
    const rootRect = root.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    resizeRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      playerX: rootRect.left - parentRect.left,
      playerY: rootRect.top - parentRect.top,
      width: root.offsetWidth,
      height: root.offsetHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const resize = resizeRef.current;
    const root = rootRef.current;
    const parent = root?.offsetParent;
    if (
      !resize ||
      resize.pointerId !== event.pointerId ||
      !root ||
      !(parent instanceof HTMLElement)
    ) {
      return;
    }
    const nextSize = clampPreviewMiniPlayerSize(
      {
        width: resize.width + event.clientX - resize.pointerX,
        height: resize.height + event.clientY - resize.pointerY,
      },
      { width: parent.clientWidth, height: parent.clientHeight },
      bottomInset,
    );
    onResize(nextSize);
    onMove(
      clampPreviewMiniPlayerPosition(
        { x: resize.playerX, y: resize.playerY },
        { width: parent.clientWidth, height: parent.clientHeight },
        nextSize,
        bottomInset,
      ),
    );
  };

  const endResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section
      ref={rootRef}
      aria-label={ariaLabel}
      {...dataAttributes}
      className="pointer-events-none absolute select-none"
      style={
        position
          ? { left: position.x, top: position.y, width: size.width, height: size.height }
          : {
              right: PREVIEW_MINI_PLAYER_EDGE_GAP,
              top: PREVIEW_MINI_PLAYER_EDGE_GAP + topOffset,
              width: size.width,
              height: size.height,
            }
      }
    >
      <div className="group pointer-events-auto absolute right-2 top-2 z-[49] size-3">
        <div
          aria-hidden="true"
          className="absolute right-0 top-0 size-2 rounded-full bg-foreground/25 shadow-sm ring-1 ring-background/70 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
        />
        <div
          className="pointer-events-none absolute right-0 top-0 flex h-8 cursor-grab items-center gap-0.5 rounded-lg border border-border/80 bg-popover/92 p-0.5 opacity-0 shadow-lg/20 backdrop-blur-xl transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 active:cursor-grabbing"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {actions}
        </div>
      </div>

      <div className="relative h-full min-h-0">
        {children}
        <div className="pointer-events-none absolute inset-0 z-[49] rounded-xl ring-1 ring-inset ring-border/80" />
        <button
          type="button"
          aria-label={resizeLabel}
          className="pointer-events-auto absolute bottom-0 right-0 z-[49] size-5 cursor-nwse-resize rounded-br-xl after:absolute after:bottom-1 after:right-1 after:size-2 after:border-b after:border-r after:border-foreground/45"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      </div>
    </section>
  );
}
