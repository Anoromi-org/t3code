// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- The broker's
// reconnect delay belongs to the Node socket it guards, outside the Effect runtime.
/**
 * The hyprnav daemon's event stream, shared by every SSE client of this server
 * process.
 *
 * hyprnav listens on a JSON-lines Unix socket next to its request socket:
 *
 *   $XDG_RUNTIME_DIR/hx/<fnv1a64(HYPRLAND_INSTANCE_SIGNATURE)>/events.sock
 *
 * It ignores input, accepts many subscribers, and on connect writes
 * `hello`, then `agents` (the full list, same shape as /api/hyprnav/agents),
 * then `slots`. Afterwards it writes `agents` on any agent change and `slots`
 * on slot changes, coalescing bursts itself.
 *
 * Exactly one upstream connection is opened per server process, lazily on the
 * first subscriber and closed when the last one goes away, so an idle server
 * holds no socket. While the daemon is down the broker retries with a 1 s → 10 s
 * backoff (never a busy loop) and reports `connected: false` to subscribers.
 *
 * `T3CODE_HYPRNAV_EVENTS_SOCKET` overrides the derived path; it exists for
 * tests that point the server at a fake daemon.
 */
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/** Connection state of the upstream daemon socket, mirrored to every client. */
export interface HyprnavStatusEvent {
  readonly kind: "status";
  readonly connected: boolean;
}

/** A line the daemon wrote, forwarded verbatim. */
export interface HyprnavDaemonEvent {
  readonly kind: "daemon";
  readonly event: "agents" | "slots";
  readonly data: string;
}

export type HyprnavStreamEvent = HyprnavStatusEvent | HyprnavDaemonEvent;

export type HyprnavEventListener = (event: HyprnavStreamEvent) => void;

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const U64_MASK = (1n << 64n) - 1n;

/** The same hash hyprnav uses to name its per-compositor runtime directory. */
export function fnv1a64Hex(input: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of Buffer.from(input, "utf8")) {
    hash = (hash ^ BigInt(byte)) & U64_MASK;
    hash = (hash * FNV_PRIME) & U64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/**
 * Resolves the events socket, or `null` when this process is not running under
 * a Hyprland session (no signature or no runtime dir) — then there is nothing
 * to connect to and clients simply see `connected: false`.
 */
export const hyprnavEventsSocketPath: Effect.Effect<string | null> = Effect.gen(function* () {
  const override = yield* Config.string("T3CODE_HYPRNAV_EVENTS_SOCKET").pipe(Config.option);
  if (Option.isSome(override) && override.value.length > 0) return override.value;
  const runtimeDir = yield* Config.string("XDG_RUNTIME_DIR").pipe(Config.option);
  const signature = yield* Config.string("HYPRLAND_INSTANCE_SIGNATURE").pipe(Config.option);
  if (Option.isNone(runtimeDir) || Option.isNone(signature)) return null;
  return NodePath.join(runtimeDir.value, "hx", fnv1a64Hex(signature.value), "events.sock");
}).pipe(Effect.orElseSucceed(() => null));

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;
/** Guards against a daemon that writes an unterminated line forever. */
const MAX_LINE_BYTES = 8 << 20;

function isForwardedEvent(value: string): value is HyprnavDaemonEvent["event"] {
  return value === "agents" || value === "slots";
}

/**
 * Ref-counted fan-out over one daemon connection. Plain Node here on purpose:
 * the lifetime is driven by HTTP clients coming and going, not by a layer.
 */
export class HyprnavEventsBroker {
  private readonly listeners = new Set<HyprnavEventListener>();
  private socket: NodeNet.Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RECONNECT_MIN_MS;
  private connected = false;
  /**
   * Whether the first connection attempt has resolved. Before it has, a new
   * subscriber is told nothing rather than "disconnected", so the UI does not
   * flash a warning during the sub-millisecond connect.
   */
  private settled = false;
  private buffer = "";
  /** Last full payload per event kind, replayed to late subscribers. */
  private readonly latest = new Map<HyprnavDaemonEvent["event"], string>();

  private readonly resolvePath: () => string | null;

  constructor(resolvePath: () => string | null) {
    this.resolvePath = resolvePath;
  }

  /** Adds a listener, opening the upstream connection if it is the first one. */
  subscribe(listener: HyprnavEventListener): () => void {
    this.listeners.add(listener);
    if (this.settled) listener({ kind: "status", connected: this.connected });
    for (const [event, data] of this.latest) listener({ kind: "daemon", event, data });
    if (this.listeners.size === 1) this.connect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.teardown();
    };
  }

  private emit(event: HyprnavStreamEvent): void {
    // Copying is deliberate: a listener may unsubscribe while being notified.
    for (const listener of Array.from(this.listeners)) listener(event);
  }

  private setConnected(connected: boolean): void {
    const wasSettled = this.settled;
    this.settled = true;
    if (wasSettled && this.connected === connected) return;
    this.connected = connected;
    this.emit({ kind: "status", connected });
  }

  private connect(): void {
    if (this.socket || this.reconnectTimer) return;
    const path = this.resolvePath();
    if (path === null) {
      this.scheduleReconnect();
      return;
    }
    this.buffer = "";
    const socket = NodeNet.createConnection({ path });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      this.reconnectDelayMs = RECONNECT_MIN_MS;
      this.setConnected(true);
    });
    socket.on("data", (chunk: string) => {
      this.ingest(chunk);
    });
    socket.on("error", () => {
      this.dropSocket();
    });
    socket.on("close", () => {
      this.dropSocket();
    });
  }

  private ingest(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.buffer = "";
      this.dropSocket();
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.handleLine(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) return;
    const event = (parsed as { event?: unknown }).event;
    if (typeof event !== "string" || !isForwardedEvent(event)) return;
    this.latest.set(event, line);
    this.emit({ kind: "daemon", event, data: line });
  }

  /** Closes a dead or dying socket and arms the next attempt. */
  private dropSocket(): void {
    const socket = this.socket;
    if (socket) {
      this.socket = null;
      socket.removeAllListeners();
      socket.destroy();
    }
    this.buffer = "";
    this.latest.clear();
    this.setConnected(false);
    if (this.listeners.size > 0) this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.listeners.size === 0) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.listeners.size > 0) this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private teardown(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    if (socket) {
      this.socket = null;
      socket.removeAllListeners();
      socket.destroy();
    }
    this.buffer = "";
    this.latest.clear();
    this.connected = false;
    this.settled = false;
    this.reconnectDelayMs = RECONNECT_MIN_MS;
  }
}

let sharedBroker: HyprnavEventsBroker | null = null;

/** The one broker per server process; the path is re-resolved on each attempt. */
export const hyprnavEventsBroker: Effect.Effect<HyprnavEventsBroker> = Effect.gen(function* () {
  if (sharedBroker) return sharedBroker;
  const path = yield* hyprnavEventsSocketPath;
  sharedBroker = new HyprnavEventsBroker(() => path);
  return sharedBroker;
});
