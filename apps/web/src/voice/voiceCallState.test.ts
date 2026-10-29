import { describe, expect, it } from "vite-plus/test";

import {
  applyVoiceEvent,
  IDLE_VOICE_CALL,
  parseVoiceEvent,
  type VoiceCallState,
} from "./voiceCallState";

const live: VoiceCallState = { ...IDLE_VOICE_CALL, status: "live" };

const apply = (state: VoiceCallState, ...events: unknown[]) =>
  events.reduce(applyVoiceEvent, state);

describe("applyVoiceEvent", () => {
  it("goes live when the session starts", () => {
    const connecting: VoiceCallState = { ...IDLE_VOICE_CALL, status: "connecting" };
    expect(applyVoiceEvent(connecting, { type: "session.started" }).status).toBe("live");
  });

  it("appends transcript chunks to the matching line", () => {
    const state = apply(
      live,
      { type: "input_transcript.added", item: { text: "Fix the" } },
      { type: "input_transcript.added", item: { text: " tests" } },
      { type: "output_transcript.added", item: { text: "On it." } },
    );
    expect(state.userLine).toBe("Fix the tests");
    expect(state.assistantLine).toBe("On it.");
  });

  it("clears only the line of the role that starts a new turn", () => {
    const state = apply(
      { ...live, userLine: "old question", assistantLine: "old answer" },
      { type: "turn.created", turn: { id: "t2", role: "user" } },
      { type: "input_transcript.added", item: { text: "New question" } },
    );
    expect(state.userLine).toBe("New question");
    expect(state.assistantLine).toBe("old answer");
  });

  it("replaces the line with the final transcript on turn.done", () => {
    const state = apply(
      { ...live, assistantLine: "Sure, I'll sta" },
      { type: "turn.done", turn: { id: "t3", role: "assistant", transcript: "Sure, I'll start." } },
    );
    expect(state.assistantLine).toBe("Sure, I'll start.");
  });

  it("returns the same state for unknown or malformed events", () => {
    for (const event of [
      { type: "turn.delta", delta: "AAAA" },
      { type: "turn.created", turn: { role: "system" } },
      { type: "input_transcript.added" },
      { type: "turn.done", turn: { role: "user" } },
      null,
      "text",
    ]) {
      expect(applyVoiceEvent(live, event)).toBe(live);
    }
  });
});

describe("parseVoiceEvent", () => {
  it("parses JSON objects and ignores everything else", () => {
    expect(parseVoiceEvent('{"type":"session.started"}')).toEqual({ type: "session.started" });
    expect(parseVoiceEvent("{broken")).toBeNull();
    expect(parseVoiceEvent(new ArrayBuffer(8))).toBeNull();
  });
});
