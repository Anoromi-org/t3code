import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";

const SAMPLE_INTERVAL_MS = 1_000;
const STALL_THRESHOLD_MS = 100;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

export const recordEventLoopSample = Effect.fnUntraced(function* (elapsedMs: number) {
  const stallDurationMs = Math.max(0, elapsedMs - SAMPLE_INTERVAL_MS);
  if (stallDurationMs < STALL_THRESHOLD_MS) return;

  const attributes = {
    "performance.sample_interval_ms": SAMPLE_INTERVAL_MS,
    "performance.elapsed_ms": elapsedMs,
    "performance.stall_duration_ms": stallDurationMs,
  };
  const endTime = yield* Clock.currentTimeNanos;
  const durationNanos = BigInt(Math.round(stallDurationMs * NANOSECONDS_PER_MILLISECOND));
  const tracer = yield* Tracer.Tracer;
  const span = tracer.span({
    name: "server.performance.event_loop_stall",
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime: endTime - durationNanos,
    kind: "internal",
    root: true,
    sampled: true,
  });
  for (const [key, value] of Object.entries(attributes)) {
    span.attribute(key, value);
  }
  span.event("Server event loop stalled.", endTime, {
    ...attributes,
    "effect.logLevel": "Warning",
  });
  span.end(endTime, Exit.void);
  yield* Effect.logWarning("Server event loop stalled.", attributes);
});

const monitor = Effect.gen(function* () {
  let previous = yield* Clock.currentTimeNanos;
  while (true) {
    yield* Effect.sleep(`${SAMPLE_INTERVAL_MS} millis`);
    const current = yield* Clock.currentTimeNanos;
    yield* recordEventLoopSample(Number(current - previous) / NANOSECONDS_PER_MILLISECOND);
    previous = current;
  }
});

export const layer = Layer.effectDiscard(Effect.forkScoped(monitor));
