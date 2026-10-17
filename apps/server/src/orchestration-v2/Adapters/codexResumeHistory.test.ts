import { assert, it } from "@effect/vitest";
import {
  MessageId,
  NodeId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import {
  type CodexHistoryTurn,
  codexReconciledHistoryArtifacts,
  unrecordedCodexTurns,
} from "./codexResumeHistory.ts";

const turn = (id: string, startedAt: number | null, items: ReadonlyArray<unknown>) =>
  ({ id, status: "completed", startedAt, completedAt: startedAt, items }) as CodexHistoryTurn;
const user = (id: string, text: string) => ({
  type: "userMessage",
  id,
  content: [{ type: "text", text }],
});
const agent = (id: string, text: string) => ({ type: "agentMessage", id, text });

it("reconciles only turns after the last one T3 Code recorded", () => {
  const turns = [turn("t1", 10, []), turn("t2", 20, []), turn("t3", 30, []), turn("t4", 40, [])];
  assert.deepEqual(
    unrecordedCodexTurns(turns, new Set(["t1", "t2"])).map((entry) => entry.id),
    ["t3", "t4"],
  );
  assert.deepEqual(unrecordedCodexTurns(turns, new Set(["t4"])), []);
  // Without a recorded anchor (a forked native thread, or history from before
  // T3 Code's thread) nothing is reconciled.
  assert.deepEqual(unrecordedCodexTurns(turns, new Set(["elsewhere"])), []);
});

it("keeps user and assistant text in conversation order with stable ids", () => {
  const artifacts = codexReconciledHistoryArtifacts({
    turns: [
      turn("t3", 100, [
        user("u1", "  continue from the CLI "),
        { type: "commandExecution", id: "cmd" },
        agent("a1", "done"),
      ]),
      // Reported in the same second: still ordered after the previous turn.
      turn("t4", 100, [user("u2", "next"), agent("a2", "")]),
    ],
    target: {
      threadId: ThreadId.make("thread-1"),
      providerThreadId: ProviderThreadId.make("provider-thread-1"),
      runId: RunId.make("run-1"),
      nodeId: NodeId.make("node-1"),
    },
    ids: {
      message: (nativeItemId) => MessageId.make(`message:${nativeItemId}`),
      turnItem: (nativeItemId) => TurnItemId.make(`item:${nativeItemId}`),
    },
    now: DateTime.makeUnsafe("2026-10-18T00:00:00.000Z"),
  });

  assert.deepEqual(
    artifacts.map(({ message }) => [message.role, message.text, message.id]),
    [
      ["user", "continue from the CLI", "message:resume-history:t3:u1"],
      ["assistant", "done", "message:resume-history:t3:a1"],
      ["user", "next", "message:resume-history:t4:u2"],
    ],
  );
  const times = artifacts.map(({ message }) => DateTime.toEpochMillis(message.createdAt));
  assert.deepEqual(times, [100_000, 100_002, 100_003]);
  assert.isTrue(artifacts.every(({ turnItem }) => turnItem.runId === "run-1"));
  assert.deepEqual(
    artifacts.map(({ turnItem }) => turnItem.type),
    ["user_message", "assistant_message", "user_message"],
  );
});
