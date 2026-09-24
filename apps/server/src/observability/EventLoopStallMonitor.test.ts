import { it } from "@effect/vitest";
import * as NodeAssert from "node:assert";
import * as Effect from "effect/Effect";
import * as Tracer from "effect/Tracer";

import { recordEventLoopSample } from "./EventLoopStallMonitor.ts";

it.effect("traces event loop samples only when they exceed the stall threshold", () => {
  const spanNames: Array<string> = [];
  const spanDurationsMs: Array<number> = [];
  const tracer = Tracer.make({
    span: (options) => {
      spanNames.push(options.name);
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        spanDurationsMs.push(Number(endTime - options.startTime) / 1_000_000);
        end(endTime, exit);
      };
      return span;
    },
  });

  return Effect.gen(function* () {
    yield* recordEventLoopSample(1_099);
    yield* recordEventLoopSample(1_100);

    NodeAssert.deepEqual(spanNames, ["server.performance.event_loop_stall"]);
    NodeAssert.deepEqual(spanDurationsMs, [100]);
  }).pipe(Effect.withTracer(tracer));
});
