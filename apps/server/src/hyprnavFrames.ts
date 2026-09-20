// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalTimersInEffect:off -- The frame socket
// is a raw Node stream handed straight to the HTTP response, and the open
// timeout guards that socket, both outside the Effect runtime.
/**
 * A live view of one desktop-agent window, streamed from hyprnav.
 *
 * Capturing frames is the daemon's job, not this server's: hyprnav listens on
 * a JSON-lines Unix socket next to its request and event sockets,
 *
 *   $XDG_RUNTIME_DIR/hx/<fnv1a64(HYPRLAND_INSTANCE_SIGNATURE)>/frames.sock
 *
 * and answers one request line
 *
 *   {"address":"0x…","fps":8,"quality":60}\n
 *
 * with either a JSON error line (`{"error":"unknown_window"}`) or a ready-made
 * `multipart/x-mixed-replace; boundary=frame` body, which this module forwards
 * byte for byte. The daemon closes the socket when the window goes away, which
 * ends the HTTP response.
 *
 * `T3CODE_HYPRNAV_FRAMES_SOCKET` overrides the derived path, like the events
 * one, so tests can point at a fake daemon.
 */
import * as NodeNet from "node:net";

import * as Effect from "effect/Effect";

import { hyprnavRuntimeSocketPath } from "./hyprnavEvents.ts";

/** @see hyprnavRuntimeSocketPath */
export const hyprnavFramesSocketPath: Effect.Effect<string | null> = hyprnavRuntimeSocketPath(
  "frames.sock",
  "T3CODE_HYPRNAV_FRAMES_SOCKET",
);

/** The multipart boundary both hyprnav and the HTTP response use. */
export const HYPRNAV_FRAMES_BOUNDARY = "frame";

export const HYPRNAV_FRAMES_CONTENT_TYPE =
  `multipart/x-mixed-replace; boundary=${HYPRNAV_FRAMES_BOUNDARY}` as const;

export interface HyprnavFramesRequest {
  readonly address: string;
  readonly fps: number;
  readonly quality: number;
}

/** The socket is live; `firstChunk` is the head of the body already read. */
export interface HyprnavFramesStream {
  readonly _tag: "stream";
  readonly socket: NodeNet.Socket;
  readonly firstChunk: Uint8Array;
}

/** The daemon knows of no such toplevel (or is not there at all). */
export interface HyprnavFramesUnavailable {
  readonly _tag: "unavailable";
  readonly reason: "unknown_window" | "no_socket" | "connect_failed";
}

export type HyprnavFramesResult = HyprnavFramesStream | HyprnavFramesUnavailable;

/** How long the daemon gets to answer the request line before we give up. */
const OPEN_TIMEOUT_MS = 5_000;

/**
 * A JSON error line is short and arrives alone, so the first chunk decides:
 * anything that is not a `{"error":…}` object is already multipart body.
 */
function readErrorLine(chunk: Uint8Array): string | null {
  if (chunk.length === 0 || chunk[0] !== 0x7b /* { */) return null;
  const text = Buffer.from(chunk).toString("utf8");
  const newline = text.indexOf("\n");
  const line = newline === -1 ? text : text.slice(0, newline);
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return null;
    const error = (parsed as { error?: unknown }).error;
    return typeof error === "string" ? error : null;
  } catch {
    return null;
  }
}

/**
 * Connects, sends the request line and waits for the first bytes back, so the
 * caller can still answer 404 instead of committing to a streamed response.
 */
export const openHyprnavFrames = (
  socketPath: string | null,
  request: HyprnavFramesRequest,
): Effect.Effect<HyprnavFramesResult> =>
  Effect.callback<HyprnavFramesResult>((resume) => {
    if (socketPath === null) {
      resume(Effect.succeed({ _tag: "unavailable", reason: "no_socket" }));
      return;
    }
    const socket = NodeNet.createConnection({ path: socketPath });
    let settled = false;
    const timer = setTimeout(() => {
      finish({ _tag: "unavailable", reason: "connect_failed" });
    }, OPEN_TIMEOUT_MS);
    timer.unref?.();

    function finish(result: HyprnavFramesResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onFailure);
      socket.removeListener("close", onFailure);
      if (result._tag !== "stream") socket.destroy();
      resume(Effect.succeed(result));
    }

    function onData(chunk: Buffer): void {
      const error = readErrorLine(chunk);
      if (error !== null) {
        finish({
          _tag: "unavailable",
          reason: error === "unknown_window" ? "unknown_window" : "connect_failed",
        });
        return;
      }
      // Stop the flow before the listener goes away, so no frame bytes are
      // dropped between here and the response stream attaching its own reader.
      socket.pause();
      finish({ _tag: "stream", socket, firstChunk: new Uint8Array(chunk) });
    }

    function onFailure(): void {
      finish({ _tag: "unavailable", reason: "connect_failed" });
    }

    socket.on("error", onFailure);
    socket.on("close", onFailure);
    socket.on("data", onData);
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          address: request.address,
          fps: request.fps,
          quality: request.quality,
        })}\n`,
      );
    });

    return Effect.sync(() => {
      // The request was interrupted before the daemon answered.
      if (!settled) finish({ _tag: "unavailable", reason: "connect_failed" });
    });
  });
