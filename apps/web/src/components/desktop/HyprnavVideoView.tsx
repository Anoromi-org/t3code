"use client";

/**
 * The picture inside a desktop-agent mini player: a canvas fed by WebCodecs,
 * with the JPEG `<img>` underneath it for browsers or daemons that cannot do
 * video. Both are always mounted so the ref exists before the stream opens and
 * the switch costs no remount.
 */
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { useHyprnavFrames } from "./useHyprnavFrames";

interface Props {
  /** The frames route URL, with `address` and any `max_width`/`follow` set. */
  readonly url: string | null;
  readonly label: string;
  /** Draws the codec, frame rate and last-frame age over the picture. */
  readonly showStats?: boolean;
  readonly className?: string;
}

export function HyprnavVideoView({ url, label, showStats = false, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { mode, codec, mjpegUrl, statsRef } = useHyprnavFrames(url, canvasRef);

  // Decoding counts frames into a ref so it never re-renders anything; the
  // overlay, when it is on at all, samples that ref on its own slow clock.
  const [stats, setStats] = useState<{ fps: number; ageMs: number | null } | null>(null);
  useEffect(() => {
    if (!showStats) return;
    const sample = () => {
      const current = statsRef.current;
      setStats({
        fps: current.fps,
        ageMs:
          current.lastFrameAt === null ? null : Math.round(performance.now() - current.lastFrameAt),
      });
    };
    const timer = setInterval(sample, 500);
    return () => clearInterval(timer);
  }, [showStats, statsRef]);

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-black", className)}>
      {/* Hidden rather than unmounted: the hook needs the canvas from the
          first effect to decide whether it can play video at all. */}
      <canvas
        ref={canvasRef}
        aria-label={label}
        className={cn(
          "absolute inset-0 size-full bg-black object-contain",
          mode === "video" ? "" : "invisible",
        )}
      />
      {mode === "mjpeg" && mjpegUrl !== null ? (
        <img src={mjpegUrl} alt="" className="absolute inset-0 size-full bg-black object-contain" />
      ) : null}
      {mode === "reconnecting" || mode === "starting" ? (
        <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[10px] text-white/70">
          {mode === "reconnecting" ? "reconnecting…" : "connecting…"}
        </span>
      ) : null}
      {showStats && stats !== null ? (
        <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1 font-mono text-[9px] text-white/80">
          {codec ?? mode} · {stats.fps.toFixed(1)} fps ·{" "}
          {stats.ageMs === null ? "—" : `${stats.ageMs} ms`}
        </span>
      ) : null}
    </div>
  );
}
