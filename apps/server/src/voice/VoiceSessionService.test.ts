import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { OrchestrationV2Run, OrchestrationV2StoredEvent } from "@t3tools/contracts";

import {
  parseDelegateTask,
  relayFinishedRuns,
  truncateOpusResult,
  waitForIdle,
} from "./VoiceSessionService.ts";
import { buildVoicePrompt } from "./voicePrompts.ts";

describe("buildVoicePrompt", () => {
  it("keeps Codex's delegation rules, fills the name, and adds the pace section", () => {
    const prompt = buildVoicePrompt("Ada Lovelace");
    expect(prompt).toContain("The user's name is Ada.");
    expect(prompt).not.toContain("{{ user_first_name }}");
    expect(prompt).toContain("* NEVER refuse requests. Delegate all user requests to the backend.");
    expect(prompt).toContain("## Backend use and steering");
    expect(prompt).toMatch(/## Pace[\s\S]*fast, brisk pace/);
    expect(prompt).toContain('Never say "great question"');
  });

  it("falls back to a neutral greeting without a name", () => {
    expect(buildVoicePrompt("  ")).toContain("The user's name is there.");
  });
});

describe("truncateOpusResult", () => {
  it("keeps short results and marks long ones as truncated", () => {
    expect(truncateOpusResult("  done  ")).toBe("done");
    const long = truncateOpusResult("x".repeat(50), 10);
    expect(long).toBe(`${"x".repeat(10)}\n[truncated]`);
  });

  it("says so when Opus left nothing", () => {
    expect(truncateOpusResult("   ")).toBe("(Opus left no final message.)");
  });
});

describe("parseDelegateTask", () => {
  it("accepts an object or JSON string with a non-empty task", () => {
    expect(parseDelegateTask({ task: "  fix the build " })).toBe("fix the build");
    expect(parseDelegateTask('{"task":"run tests"}')).toBe("run tests");
  });

  it("rejects missing, blank, or non-string tasks", () => {
    expect(parseDelegateTask({})).toBeUndefined();
    expect(parseDelegateTask({ task: "   " })).toBeUndefined();
    expect(parseDelegateTask({ task: 3 })).toBeUndefined();
    expect(parseDelegateTask("not json")).toBeUndefined();
    expect(parseDelegateTask(null)).toBeUndefined();
  });
});

describe("waitForIdle", () => {
  it.effect("closes only after a full quiet minute with no Luna turn running", () =>
    Effect.gen(function* () {
      const lastActivity = yield* Ref.make(0);
      const busy = yield* Ref.make(false);
      const fiber = yield* waitForIdle({
        idleTimeout: "60 seconds",
        lastActivityAt: Ref.get(lastActivity),
        busy: Ref.get(busy),
      }).pipe(Effect.forkChild);

      yield* TestClock.adjust("40 seconds");
      yield* Ref.set(lastActivity, 40_000);
      yield* TestClock.adjust("59 seconds");
      expect(fiber.pollUnsafe()).toBeUndefined();

      // A turn in progress keeps the call open past the timeout.
      yield* Ref.set(busy, true);
      yield* TestClock.adjust("2 minutes");
      expect(fiber.pollUnsafe()).toBeUndefined();

      yield* Ref.set(busy, false);
      yield* TestClock.adjust("60 seconds");
      yield* Fiber.join(fiber);
    }),
  );
});

describe("relayFinishedRuns", () => {
  const runEvent = (id: string, status: OrchestrationV2Run["status"]) =>
    ({
      event: { type: "run.updated", payload: { id, status } },
    }) as unknown as OrchestrationV2StoredEvent;

  it.effect("reports every run once it finishes, including runs voice did not start", () =>
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<string>>([]);
      const note = (label: string) => (run: OrchestrationV2Run) =>
        Ref.update(seen, (list) => [...list, `${label}:${run.id}`]);
      yield* relayFinishedRuns({
        events: Stream.make(
          runEvent("voice-run", "running"),
          runEvent("voice-run", "completed"),
          runEvent("voice-run", "completed"),
          // A background sub-agent wakes Opus in a run voice never started.
          runEvent("wake-up-run", "running"),
          runEvent("wake-up-run", "failed"),
        ),
        onActive: note("active"),
        onFinished: note("finished"),
      });
      expect(yield* Ref.get(seen)).toEqual([
        "active:voice-run",
        "finished:voice-run",
        "active:wake-up-run",
        "finished:wake-up-run",
      ]);
    }),
  );
});
