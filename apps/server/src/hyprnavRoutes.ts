// @effect-diagnostics nodeBuiltinImport:off
/**
 * Loopback-only HTTP routes exposing hyprnav's desktop-agent registry to the
 * web client when it runs in a browser on the same machine (no Electron
 * bridge). They wrap the `hyprnav` CLI's JSON output:
 *
 *   GET  /api/hyprnav/agents               -> agents_list
 *   GET  /api/hyprnav/events                -> Server-Sent Events, live
 *   GET  /api/hyprnav/frames?address=0x…   -> live frames of a window, video or JPEG
 *   POST /api/hyprnav/screencast {address} -> pre-answer the next share picker
 *   POST /api/hyprnav/goto {env, slot}     -> hyprnav goto
 *
 * Only requests that arrive on a loopback host are served; anything else gets
 * 404 so the routes are invisible over LAN or Tailscale.
 */
import * as NodeChildProcess from "node:child_process";
import type * as NodeNet from "node:net";

import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { type HyprnavEventsBroker, hyprnavEventsBroker } from "./hyprnavEvents.ts";
import {
  type HyprnavFramesRequest,
  hyprnavFramesContentType,
  hyprnavFramesSocketPath,
  openHyprnavFrames,
} from "./hyprnavFrames.ts";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

class HyprnavRouteError extends Schema.TaggedErrorClass<HyprnavRouteError>()("HyprnavRouteError", {
  args: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

const runHyprnavJson = (args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<unknown>((resolve, reject) => {
        NodeChildProcess.execFile(
          "hyprnav",
          [...args],
          { timeout: 5_000, maxBuffer: 4 << 20 },
          (error, stdout) => {
            if (error) {
              reject(error);
              return;
            }
            try {
              resolve(JSON.parse(stdout));
            } catch (parseError) {
              reject(parseError);
            }
          },
        );
      }),
    catch: (cause) => new HyprnavRouteError({ args: [...args], cause }),
  });

const requestIsLoopback = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const host = request.headers.host ?? "";
  const hostname = host.replace(/:\d+$/u, "");
  return LOOPBACK_HOSTNAMES.has(hostname);
});

const notFound = HttpServerResponse.empty({ status: 404 });

/** hyprland window handles, with or without the `address:` prefix hyprnav accepts. */
const ADDRESS_PATTERN = /^(address:)?0x[0-9a-fA-F]+$/u;

const ScreencastBody = Schema.Struct({ address: Schema.String });
const GotoBody = Schema.Struct({ env: Schema.String, slot: Schema.Number });

export const hyprnavAgentsRouteLayer = HttpRouter.add(
  "GET",
  "/api/hyprnav/agents",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const agents = yield* runHyprnavJson(["agents"]).pipe(Effect.orElseSucceed(() => []));
    return HttpServerResponse.jsonUnsafe(agents);
  }),
);

export const hyprnavScreencastRouteLayer = HttpRouter.add(
  "POST",
  "/api/hyprnav/screencast",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const decoded = Schema.decodeUnknownOption(ScreencastBody)(body);
    if (decoded._tag === "None" || !ADDRESS_PATTERN.test(decoded.value.address)) {
      return HttpServerResponse.empty({ status: 400 });
    }
    yield* runHyprnavJson(["screencast", "request", decoded.value.address]).pipe(
      Effect.orElseSucceed(() => null),
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }),
);

export const hyprnavGotoRouteLayer = HttpRouter.add(
  "POST",
  "/api/hyprnav/goto",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const decoded = Schema.decodeUnknownOption(GotoBody)(body);
    if (decoded._tag === "None") {
      return HttpServerResponse.empty({ status: 400 });
    }
    yield* runHyprnavJson([
      "goto",
      "--env",
      decoded.value.env,
      "--slot",
      String(decoded.value.slot),
    ]).pipe(Effect.orElseSucceed(() => null));
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }),
);

/**
 * Proxies the daemon's event socket as SSE. Every client shares one upstream
 * connection (see hyprnavEvents.ts); `event: status` carries the health of
 * that connection so the UI can say it is disconnected instead of silently
 * showing a stale list.
 */
const HEARTBEAT_INTERVAL = "15 seconds";

const encoder = new TextEncoder();

/** Proxies drop idle connections; an SSE comment is a no-op for EventSource. */
const heartbeatChunks = Stream.map(
  // tick fires once immediately; the stream already opens with a comment.
  Stream.drop(Stream.tick(HEARTBEAT_INTERVAL), 1),
  () => encoder.encode(": ping\n\n"),
);

const subscriptionChunks = (broker: HyprnavEventsBroker): Stream.Stream<Uint8Array> =>
  Stream.callback<Uint8Array>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const push = (chunk: string) => {
          Queue.offerUnsafe(queue, encoder.encode(chunk));
        };
        // Opening comment: flushes headers so the client fires `open` even
        // before the daemon has anything to say.
        push(": hyprnav events\n\n");
        const unsubscribe = broker.subscribe((event) => {
          push(
            event.kind === "status"
              ? `event: status\ndata: ${JSON.stringify({ connected: event.connected })}\n\n`
              : `event: ${event.event}\ndata: ${event.data}\n\n`,
          );
        });
        return { unsubscribe } as const;
      }),
      ({ unsubscribe }) => Effect.sync(unsubscribe),
    ),
  );

const sseChunks = (broker: HyprnavEventsBroker): Stream.Stream<Uint8Array> =>
  Stream.merge(subscriptionChunks(broker), heartbeatChunks);

export const hyprnavEventsRouteLayer = HttpRouter.add(
  "GET",
  "/api/hyprnav/events",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const broker = yield* hyprnavEventsBroker;
    return HttpServerResponse.stream(sseChunks(broker), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Opt out of the global compression middleware (which would otherwise
        // buffer this text/* body) and of nginx-style proxy buffering.
        "Content-Encoding": "identity",
        "X-Accel-Buffering": "no",
      },
    });
  }),
);

/**
 * A live view of one window an agent is working on.
 *
 * The bytes come ready-made from hyprnav (see hyprnavFrames.ts) and are piped
 * through untouched. Two gates stand in front: the loopback check every route
 * here shares, and an allowlist of the windows currently registered agents say
 * they are acting on. The allowlist matters because the loopback check alone is
 * satisfied by anything the dev Vite proxy forwards, and a window's pixels are
 * a lot more than a list of agent labels.
 */
const framesAddressAllowed = (agents: unknown, address: string): boolean => {
  const list = Array.isArray(agents)
    ? agents
    : ((agents as { agents?: unknown } | null)?.agents ?? null);
  if (!Array.isArray(list)) return false;
  const wanted = address.replace(/^address:/u, "");
  const matches = (value: unknown) =>
    typeof value === "string" && value.replace(/^address:/u, "") === wanted;
  return list.some((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const agent = entry as { current_target?: unknown; attached_windows?: unknown };
    if (matches(agent.current_target)) return true;
    return Array.isArray(agent.attached_windows) && agent.attached_windows.some(matches);
  });
};

/** Frame rate and JPEG quality asked of the daemon; it may serve less. */
const FRAMES_FPS = 8;
const FRAMES_QUALITY = 60;

/**
 * Codecs the daemon is allowed to be asked for. The client sends what its
 * `VideoDecoder` says it can play, in preference order; this list keeps a
 * crafted query from turning into arbitrary text on the daemon's request line,
 * and keeps the order the client asked for.
 */
const FRAMES_KNOWN_CODECS = new Set(["av1", "h264", "hevc", "vp9", "vp8", "mjpeg"]);

/** Width tiers of FRAMES-VIDEO-PLAN §2; anything else is rounded up to one. */
const FRAMES_WIDTH_TIERS = [320, 640, 960, 1280] as const;

const parseFramesCodecs = (raw: string | null): ReadonlyArray<string> => {
  const asked = (raw ?? "")
    .split(",")
    .map((codec) => codec.trim().toLowerCase())
    .filter((codec) => FRAMES_KNOWN_CODECS.has(codec));
  // Deduplicate but keep first occurrence, and always leave a fallback in.
  const unique = [...new Set(asked)];
  return unique.includes("mjpeg") ? unique : [...unique, "mjpeg"];
};

const parseFramesWidth = (raw: string | null): number => {
  const asked = Number(raw ?? "");
  if (!Number.isFinite(asked) || asked <= 0) return 640;
  return FRAMES_WIDTH_TIERS.find((tier) => tier >= asked) ?? FRAMES_WIDTH_TIERS.at(-1)!;
};

const parseFramesFps = (raw: string | null): number => {
  const asked = Number(raw ?? "");
  if (raw === null || raw.trim() === "" || !Number.isFinite(asked)) return FRAMES_FPS;
  return Math.min(15, Math.max(1, Math.round(asked)));
};

/** The negotiated request line, from the query the mini player sent. */
export const hyprnavFramesRequestFromQuery = (
  address: string,
  params: URLSearchParams,
): HyprnavFramesRequest => {
  const maxFps = parseFramesFps(params.get("max_fps"));
  return {
    address,
    fps: maxFps,
    quality: FRAMES_QUALITY,
    codecs: parseFramesCodecs(params.get("codecs")),
    maxWidth: parseFramesWidth(params.get("max_width")),
    maxFps,
    follow: params.get("follow") === "transient" ? "transient" : "target",
  };
};

const frameChunks = (socket: NodeNet.Socket, firstChunk: Uint8Array): Stream.Stream<Uint8Array> =>
  Stream.callback<Uint8Array>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        Queue.offerUnsafe(queue, firstChunk);
        const onData = (chunk: Buffer) => {
          Queue.offerUnsafe(queue, new Uint8Array(chunk));
        };
        // The daemon closing the socket is how a vanished window ends the body.
        const onDone = () => {
          Queue.endUnsafe(queue);
        };
        socket.on("data", onData);
        socket.on("close", onDone);
        socket.on("error", onDone);
        socket.resume();
        return { socket } as const;
      }),
      ({ socket: open }) =>
        Effect.sync(() => {
          open.removeAllListeners();
          open.destroy();
        }),
    ),
  );

export const hyprnavFramesRouteLayer = HttpRouter.add(
  "GET",
  "/api/hyprnav/frames",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    const params = url._tag === "Some" ? url.value.searchParams : new URLSearchParams();
    const address = params.get("address") ?? "";
    if (!ADDRESS_PATTERN.test(address)) return HttpServerResponse.empty({ status: 400 });
    const agents = yield* runHyprnavJson(["agents"]).pipe(Effect.orElseSucceed(() => []));
    if (!framesAddressAllowed(agents, address)) return notFound;
    const socketPath = yield* hyprnavFramesSocketPath;
    const opened = yield* openHyprnavFrames(
      socketPath,
      hyprnavFramesRequestFromQuery(address, params),
    );
    if (opened._tag !== "stream") return notFound;
    // The daemon answered with the codec it picked, not the one we ranked
    // first, so the body itself decides the content type.
    return HttpServerResponse.stream(frameChunks(opened.socket, opened.firstChunk), {
      headers: {
        "Content-Type": hyprnavFramesContentType(opened.firstChunk),
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Same reasoning as the SSE route: no compression middleware, no proxy
        // buffering, or the client sees a frame only once the buffer fills.
        "Content-Encoding": "identity",
        "X-Accel-Buffering": "no",
      },
    });
  }),
);

export const hyprnavRoutesLayer = Layer.mergeAll(
  hyprnavAgentsRouteLayer,
  hyprnavScreencastRouteLayer,
  hyprnavGotoRouteLayer,
  hyprnavEventsRouteLayer,
  hyprnavFramesRouteLayer,
);
