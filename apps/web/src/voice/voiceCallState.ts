import type { EnvironmentId, ThreadId, VoiceSessionId } from "@t3tools/contracts";

export type VoiceCallStatus = "idle" | "connecting" | "live" | "error";

export interface VoiceCallState {
  readonly status: VoiceCallStatus;
  readonly error?: string;
  readonly muted: boolean;
  readonly userLine: string;
  readonly assistantLine: string;
  readonly voiceSessionId?: VoiceSessionId;
  readonly environmentId?: EnvironmentId;
  // Absent for a call started from a draft composer; the server launches the
  // thread on its first delegation.
  readonly threadId?: ThreadId;
}

export const IDLE_VOICE_CALL: VoiceCallState = {
  status: "idle",
  muted: false,
  userLine: "",
  assistantLine: "",
};

type Role = "user" | "assistant";

const lineKey = (role: Role) => (role === "user" ? "userLine" : "assistantLine");

function readRole(value: unknown): Role | null {
  return value === "user" || value === "assistant" ? value : null;
}

function readItemText(event: Record<string, unknown>): string | null {
  const item = event.item;
  if (typeof item !== "object" || item === null) return null;
  const text = (item as Record<string, unknown>).text;
  return typeof text === "string" ? text : null;
}

function readTurn(event: Record<string, unknown>): Record<string, unknown> | null {
  const turn = event.turn;
  return typeof turn === "object" && turn !== null ? (turn as Record<string, unknown>) : null;
}

/**
 * Applies one GPT-Live data channel event. Only the latest line per role is
 * kept: a new turn of that role clears its line, transcript chunks append, and
 * `turn.done` replaces the line with the final text. Unknown events return the
 * same state object so callers can skip notifying subscribers.
 */
export function applyVoiceEvent(state: VoiceCallState, event: unknown): VoiceCallState {
  if (typeof event !== "object" || event === null) return state;
  const record = event as Record<string, unknown>;
  switch (record.type) {
    case "session.started":
      return state.status === "connecting" ? { ...state, status: "live" } : state;
    case "input_transcript.added":
    case "output_transcript.added": {
      const text = readItemText(record);
      if (!text) return state;
      const key = lineKey(record.type === "input_transcript.added" ? "user" : "assistant");
      return { ...state, [key]: state[key] + text };
    }
    case "turn.created": {
      const role = readRole(readTurn(record)?.role);
      if (role === null) return state;
      const key = lineKey(role);
      return state[key] === "" ? state : { ...state, [key]: "" };
    }
    case "turn.done": {
      const turn = readTurn(record);
      const role = readRole(turn?.role);
      const transcript = turn?.transcript;
      if (role === null || typeof transcript !== "string" || transcript.trim() === "") return state;
      return { ...state, [lineKey(role)]: transcript.trim() };
    }
    default:
      return state;
  }
}

/** Parses a data channel frame without paying for JSON.parse on non-JSON payloads. */
export function parseVoiceEvent(data: unknown): unknown {
  if (typeof data !== "string" || data.charCodeAt(0) !== 123 /* { */) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
