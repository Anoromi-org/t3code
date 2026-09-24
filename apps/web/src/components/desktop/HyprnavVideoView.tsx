"use client";

/**
 * The picture inside a desktop-agent mini player: a canvas fed by WebCodecs,
 * with the JPEG `<img>` underneath it for browsers or daemons that cannot do
 * video. Both are always mounted so the ref exists before the stream opens and
 * the switch costs no remount.
 */
import { useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { type HyprnavFrameSize, useHyprnavFrames } from "./useHyprnavFrames";

interface Props {
  /** The frames route URL, with `address` and any `max_width`/`follow` set. */
  readonly url: string | null;
  readonly label: string;
  /** Draws the codec, frame rate and last-frame age over the picture. */
  readonly showStats?: boolean;
  readonly className?: string;
  /** Reports the size of the picture as it arrives, video or JPEG. */
  readonly onFrameSize?: (size: HyprnavFrameSize) => void;
}

export function HyprnavVideoView({ url, label, showStats = false, className, onFrameSize }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { mode, codec, mjpegUrl, statsRef } = useHyprnavFrames(url, canvasRef, onFrameSize);

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
        <MjpegView url={mjpegUrl} {...(onFrameSize ? { onFrameSize } : {})} />
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

/** Reconnect backoff for the JPEG stream, which an `<img>` never retries itself. */
const MJPEG_RETRY_DELAYS_MS = [400, 800, 1_600, 3_200, 5_000];

function MjpegView({
  url,
  onFrameSize,
}: {
  readonly url: string;
  readonly onFrameSize?: (size: HyprnavFrameSize) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const failuresRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(retryTimerRef.current), []);

  return (
    <img
      // A new element opens a new request; the same src on the old one would not.
      key={attempt}
      src={url}
      alt=""
      className="absolute inset-0 size-full bg-black object-contain"
      onLoad={(event) => {
        failuresRef.current = 0;
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          onFrameSize?.({ width: image.naturalWidth, height: image.naturalHeight });
        }
      }}
      onError={() => {
        const delay =
          MJPEG_RETRY_DELAYS_MS[Math.min(failuresRef.current, MJPEG_RETRY_DELAYS_MS.length - 1)];
        failuresRef.current += 1;
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => setAttempt((current) => current + 1), delay);
      }}
    />
  );
}
