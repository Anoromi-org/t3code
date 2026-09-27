/**
 * The one EventSource on /api/hyprnav/events this page holds, shared by every
 * consumer (the desktop-agents store, the lock follower). It opens with the
 * first subscriber and closes with the last, so a page with neither mounted
 * holds no stream.
 *
 * The last payload of each event is kept and replayed to a subscriber that
 * joins an already open stream, the same way the server replays its latest
 * lines to a new SSE client.
 */
import { resolvePrimaryEnvironmentHttpUrl } from "./environments/primary/target";

export type HyprnavStreamEventName = "agents" | "status" | "locked";

export interface HyprnavEventStreamListener {
  /** A named SSE event with its raw JSON payload. */
  readonly onEvent?: (name: HyprnavStreamEventName, data: string) => void;
  /** The stream (re)connected; the server replays its latest lines next. */
  readonly onOpen?: () => void;
  /**
   * The stream is unavailable (no EventSource, no route, not loopback) and
   * will not be retried while subscribers remain.
   */
  readonly onUnavailable?: () => void;
}

const EVENT_NAMES: ReadonlyArray<HyprnavStreamEventName> = ["agents", "status", "locked"];
/** Consecutive EventSource failures before giving up on the stream for good. */
const SSE_FAILURE_LIMIT = 3;

const listeners = new Set<HyprnavEventStreamListener>();
const latest = new Map<HyprnavStreamEventName, string>();
let eventSource: EventSource | null = null;
let sseFailures = 0;
let unavailable = false;

function resolveEventsUrl(): string | null {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return null;
  try {
    return resolvePrimaryEnvironmentHttpUrl("/api/hyprnav/events");
  } catch {
    return null;
  }
}

function each(notify: (listener: HyprnavEventStreamListener) => void): void {
  // Copying is deliberate: a listener may unsubscribe while being notified.
  for (const listener of Array.from(listeners)) notify(listener);
}

function markUnavailable(): void {
  unavailable = true;
  each((listener) => listener.onUnavailable?.());
}

function open(): void {
  const url = resolveEventsUrl();
  if (url === null) {
    markUnavailable();
    return;
  }
  const source = new EventSource(url);
  eventSource = source;
  source.addEventListener("open", () => {
    sseFailures = 0;
    each((listener) => listener.onOpen?.());
  });
  for (const name of EVENT_NAMES) {
    source.addEventListener(name, (event: MessageEvent<string>) => {
      latest.set(name, event.data);
      each((listener) => listener.onEvent?.(name, event.data));
    });
  }
  source.addEventListener("error", () => {
    // EventSource retries on its own; only a run of failures means the route
    // is not there (old server, no loopback).
    sseFailures += 1;
    if (sseFailures < SSE_FAILURE_LIMIT) return;
    source.close();
    if (eventSource === source) eventSource = null;
    markUnavailable();
  });
}

function close(): void {
  eventSource?.close();
  eventSource = null;
  sseFailures = 0;
  unavailable = false;
  latest.clear();
}

export function subscribeHyprnavEventStream(listener: HyprnavEventStreamListener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    open();
  } else if (unavailable) {
    listener.onUnavailable?.();
  } else {
    for (const [name, data] of latest) listener.onEvent?.(name, data);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    listeners.delete(listener);
    if (listeners.size === 0) close();
  };
}
