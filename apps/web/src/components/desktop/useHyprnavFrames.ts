"use client";

/**
 * Plays hyprnav's frame stream into a canvas with WebCodecs, and falls back to
 * the JPEG `<img>` when it cannot.
 *
 * The stream is damage-driven: a window that is not moving sends nothing at
 * all, so there is no timeline, no buffering and no stall to recover from —
 * only records arriving whenever the window changed, which is exactly what a
 * `VideoDecoder` feeding a canvas wants (see FRAMES-VIDEO-PLAN §5 for why not
 * MSE). Every record is one `EncodedVideoChunk`, the CONFIG record says which
 * codec the daemon picked, and KEEPALIVE tells "static" apart from "dead".
 */
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import {
  createHyprnavRecordParser,
  hyprnavCodecFamily,
  HYPRNAV_RECORD_CONFIG,
  HYPRNAV_RECORD_KEEPALIVE,
  hyprnavRecordIsKeyframe,
  parseHyprnavFramesConfig,
} from "./hyprnavFrameRecords";
import {
  HYPRNAV_FALLBACK_CODEC,
  hyprnavFramesUrlWithCodecs,
  hyprnavPlaybackMode,
  probeHyprnavCodecs,
} from "./hyprnavCodecs";

export type HyprnavFramesMode =
  /** Probing the browser and opening the stream; nothing painted yet. */
  | "starting"
  /** Decoding records into the canvas. */
  | "video"
  /** No WebCodecs, or the daemon chose JPEG: the `<img>` takes over. */
  | "mjpeg"
  /** The stream ended or failed; waiting out the backoff before trying again. */
  | "reconnecting";

export interface HyprnavFramesStats {
  readonly codec: string | null;
  readonly frames: number;
  /** Decoded frames per second over the last second or so. */
  readonly fps: number;
  /** `performance.now()` of the last painted frame, or null. */
  readonly lastFrameAt: number | null;
  readonly width: number;
  readonly height: number;
}

export interface HyprnavFramesPlayer {
  readonly mode: HyprnavFramesMode;
  /** Set once the daemon has said which codec it is sending. */
  readonly codec: string | null;
  /** The URL for the `<img>` fallback, already pinned to JPEG. */
  readonly mjpegUrl: string | null;
  /** Live counters for the debug overlay; deliberately not React state. */
  readonly statsRef: RefObject<HyprnavFramesStats>;
}

/** Reconnect backoff while the player stays open, in milliseconds. */
const RETRY_DELAYS_MS = [400, 800, 1_600, 3_200, 5_000];

const emptyStats: HyprnavFramesStats = {
  codec: null,
  frames: 0,
  fps: 0,
  lastFrameAt: null,
  width: 0,
  height: 0,
};

export function useHyprnavFrames(
  url: string | null,
  canvasRef: RefObject<HTMLCanvasElement | null>,
): HyprnavFramesPlayer {
  const [mode, setMode] = useState<HyprnavFramesMode>("starting");
  const [codec, setCodec] = useState<string | null>(null);
  const statsRef = useRef<HyprnavFramesStats>(emptyStats);

  const mjpegUrl = useMemo(
    () => (url === null ? null : hyprnavFramesUrlWithCodecs(url, [HYPRNAV_FALLBACK_CODEC])),
    [url],
  );

  useEffect(() => {
    if (url === null) return;
    const canvas = canvasRef.current;
    let stopped = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let decoder: VideoDecoder | null = null;
    statsRef.current = emptyStats;

    const hasVideoDecoder = typeof globalThis.VideoDecoder !== "undefined";
    if (!hasVideoDecoder || canvas === null) {
      setMode("mjpeg");
      return;
    }
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (context === null) {
      setMode("mjpeg");
      return;
    }

    /**
     * The canvas backing store follows the decoded frame, but never grows past
     * what the element can actually show at this display's pixel ratio: the
     * player is a few hundred CSS pixels and the stream may be 960 wide.
     */
    const paint = (frame: VideoFrame) => {
      const ratio = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth || frame.displayWidth;
      const wanted = Math.max(1, Math.min(frame.displayWidth, Math.round(cssWidth * ratio)));
      const scale = wanted / frame.displayWidth;
      const height = Math.max(1, Math.round(frame.displayHeight * scale));
      if (canvas.width !== wanted || canvas.height !== height) {
        canvas.width = wanted;
        canvas.height = height;
      }
      context.drawImage(frame, 0, 0, wanted, height);
      const now = performance.now();
      const previous = statsRef.current;
      const gap = previous.lastFrameAt === null ? 0 : now - previous.lastFrameAt;
      statsRef.current = {
        codec: previous.codec,
        frames: previous.frames + 1,
        // Smoothed so a damage-driven stream's bursts do not read as 60 fps.
        fps: gap > 0 ? previous.fps * 0.7 + (1000 / gap) * 0.3 : previous.fps,
        lastFrameAt: now,
        width: frame.displayWidth,
        height: frame.displayHeight,
      };
    };

    const closeDecoder = () => {
      if (decoder === null) return;
      const closing = decoder;
      decoder = null;
      try {
        if (closing.state !== "closed") closing.close();
      } catch {
        // A decoder that already errored out throws on close; nothing to do.
      }
    };

    /** Returns true when the stream ended and a reconnect is in order. */
    const readStream = async (body: ReadableStream<Uint8Array>): Promise<void> => {
      const reader = body.getReader();
      const parser = createHyprnavRecordParser();
      let currentCodec: string | null = null;
      let sawKeyframe = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || stopped) return;
          for (const record of parser.push(value)) {
            if ((record.flags & HYPRNAV_RECORD_KEEPALIVE) !== 0) continue;
            if ((record.flags & HYPRNAV_RECORD_CONFIG) !== 0) {
              const config = parseHyprnavFramesConfig(record.payload);
              if (config === null) continue;
              // A new CONFIG means the encoder restarted (width tier, or
              // follow=transient swapping to a dialog): start over.
              closeDecoder();
              sawKeyframe = false;
              currentCodec = config.codec;
              const next = new VideoDecoder({
                output: (frame) => {
                  try {
                    paint(frame);
                  } finally {
                    frame.close();
                  }
                },
                error: () => {
                  // Dropping the reader ends the read loop into a reconnect,
                  // which is the only recovery a decoder error has.
                  controller?.abort();
                },
              });
              // AV1 takes no out-of-band description: the sequence header
              // lives in the bitstream. Some daemons still put one in the
              // CONFIG record, and Firefox then configures happily and fails
              // the first chunk with "The given encoding is not supported",
              // which reads as an endless reconnect. Drop it.
              const description =
                hyprnavCodecFamily(config.codec) === "av1" ? null : config.description;
              next.configure({
                codec: config.codec,
                optimizeForLatency: true,
                ...(description === null ? {} : { description }),
              });
              decoder = next;
              statsRef.current = { ...statsRef.current, codec: config.codec };
              setCodec(config.codec);
              setMode("video");
              // A stream that got as far as its config is a healthy one; the
              // next drop should retry fast, not at the tail of the backoff.
              attempt = 0;
              continue;
            }
            if (decoder === null || record.payload.length === 0) continue;
            const key = hyprnavRecordIsKeyframe(currentCodec ?? "", record);
            // Deltas before the first keyframe reference frames nobody has.
            if (!key && !sawKeyframe) continue;
            sawKeyframe = true;
            decoder.decode(
              new EncodedVideoChunk({
                type: key ? "key" : "delta",
                timestamp: record.timestampUs,
                data: record.payload,
              }),
            );
          }
        }
      } finally {
        reader.cancel().catch(() => {});
      }
    };

    const connect = async (): Promise<void> => {
      const codecs = await probeHyprnavCodecs();
      if (stopped) return;
      if (codecs.length === 1) {
        // Only the fallback survived the probe.
        setMode("mjpeg");
        return;
      }
      controller = new AbortController();
      const response = await fetch(hyprnavFramesUrlWithCodecs(url, codecs), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (stopped) return;
      if (!response.ok || response.body === null) throw new Error(`frames ${response.status}`);
      const chosen = hyprnavPlaybackMode({
        contentType: response.headers.get("content-type"),
        hasVideoDecoder: true,
      });
      if (chosen === "mjpeg") {
        // The daemon could not encode anything this browser asked for; let the
        // `<img>` open its own request and drop this one.
        controller.abort();
        setMode("mjpeg");
        return;
      }
      await readStream(response.body);
    };

    const run = () => {
      connect()
        .then(() => {
          if (stopped) return;
          // The stream ended: the window went away, or the daemon restarted.
          closeDecoder();
          scheduleRetry();
        })
        .catch(() => {
          if (stopped) return;
          closeDecoder();
          scheduleRetry();
        });
    };

    const scheduleRetry = () => {
      setMode((current) => (current === "mjpeg" ? current : "reconnecting"));
      const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
      attempt += 1;
      retryTimer = setTimeout(() => {
        if (stopped) return;
        run();
      }, delay);
    };

    run();

    return () => {
      stopped = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      controller?.abort();
      closeDecoder();
    };
  }, [url, canvasRef]);

  return { mode, codec, mjpegUrl, statsRef };
}
