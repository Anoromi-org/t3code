import * as Schema from "effect/Schema";

import { ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const VoiceSessionId = TrimmedNonEmptyString.pipe(Schema.brand("VoiceSessionId"));
export type VoiceSessionId = typeof VoiceSessionId.Type;

export const VoiceStartInput = Schema.Struct({
  projectId: ProjectId,
  // The thread the user is looking at. Delegated work goes there; without one
  // the first delegation launches a new thread.
  threadId: Schema.optional(ThreadId),
  // WebRTC SDP offer. The client creates the `oai-events` data channel before
  // the offer, and media flows client <-> OpenAI directly.
  sdp: Schema.String,
});
export type VoiceStartInput = typeof VoiceStartInput.Type;

export const VoiceStartResult = Schema.Struct({
  voiceSessionId: VoiceSessionId,
  sdp: Schema.String,
});
export type VoiceStartResult = typeof VoiceStartResult.Type;

export const VoiceStopInput = Schema.Struct({
  voiceSessionId: VoiceSessionId,
});
export type VoiceStopInput = typeof VoiceStopInput.Type;

export class VoiceSessionError extends Schema.TaggedError<VoiceSessionError>()(
  "VoiceSessionError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
