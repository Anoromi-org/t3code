import type { EnvironmentId, ProjectId, ThreadId, VoiceSessionId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useSyncExternalStore } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { serverEnvironment } from "../state/server";
import {
  applyVoiceEvent,
  IDLE_VOICE_CALL,
  parseVoiceEvent,
  type VoiceCallState,
} from "./voiceCallState";

export interface VoiceCallTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId?: ThreadId;
}

export type VoiceCallSnapshot = VoiceCallState & { readonly projectId?: ProjectId };

interface ActiveCall {
  readonly target: VoiceCallTarget;
  readonly audio: HTMLAudioElement;
  stream: MediaStream | null;
  pc: RTCPeerConnection | null;
  voiceSessionId: VoiceSessionId | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

const ICE_GATHERING_TIMEOUT_MS = 2_000;
// A brief "disconnected" is normal ICE churn; only treat a sustained one as the
// server having ended the call.
const DISCONNECTED_GRACE_MS = 3_000;

let snapshot: VoiceCallSnapshot = IDLE_VOICE_CALL;
let active: ActiveCall | null = null;
const listeners = new Set<() => void>();

function setSnapshot(next: VoiceCallSnapshot) {
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => snapshot;

export function useVoiceCall(): VoiceCallSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Why this page cannot capture a microphone, or null when it can. */
export function voiceUnsupportedReason(): string | null {
  if (typeof window === "undefined" || !window.isSecureContext || !navigator.mediaDevices) {
    return "Voice needs HTTPS or localhost";
  }
  return null;
}

function targetFields(target: VoiceCallTarget) {
  return {
    environmentId: target.environmentId,
    projectId: target.projectId,
    ...(target.threadId ? { threadId: target.threadId } : {}),
  };
}

function release(call: ActiveCall) {
  if (call.disconnectTimer !== null) clearTimeout(call.disconnectTimer);
  call.disconnectTimer = null;
  call.pc?.close();
  for (const track of call.stream?.getTracks() ?? []) track.stop();
  call.audio.pause();
  call.audio.srcObject = null;
}

function sendStop(call: ActiveCall) {
  if (call.voiceSessionId === null) return;
  // The server may already have ended the session (silence timeout), so a
  // failure here is expected and not worth surfacing.
  void runAtomCommand(
    appAtomRegistry,
    serverEnvironment.stopVoice,
    {
      environmentId: call.target.environmentId,
      input: { voiceSessionId: call.voiceSessionId },
    },
    { label: "voice stop", reportFailure: false },
  );
}

/** Ends the call after the server or network closed it; no RPC is needed. */
function endFromRemote(call: ActiveCall) {
  if (active !== call) return;
  active = null;
  release(call);
  setSnapshot(IDLE_VOICE_CALL);
}

export function stopVoiceCall() {
  const call = active;
  active = null;
  if (call !== null) {
    release(call);
    sendStop(call);
  }
  setSnapshot(IDLE_VOICE_CALL);
}

export function toggleVoiceMute() {
  const track = active?.stream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  setSnapshot({ ...snapshot, muted: !track.enabled });
}

function waitForIceGathering(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, ICE_GATHERING_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone found";
  }
  return error instanceof Error ? error.message : String(error);
}

function watchConnection(call: ActiveCall, pc: RTCPeerConnection) {
  pc.addEventListener("connectionstatechange", () => {
    if (active !== call) return;
    const state = pc.connectionState;
    if (state === "connected") {
      if (call.disconnectTimer !== null) clearTimeout(call.disconnectTimer);
      call.disconnectTimer = null;
      if (snapshot.status === "connecting") setSnapshot({ ...snapshot, status: "live" });
    } else if (state === "failed" || state === "closed") {
      endFromRemote(call);
    } else if (state === "disconnected" && call.disconnectTimer === null) {
      call.disconnectTimer = setTimeout(() => {
        call.disconnectTimer = null;
        if (pc.connectionState === "disconnected") endFromRemote(call);
      }, DISCONNECTED_GRACE_MS);
    }
  });
}

/**
 * Starts a GPT-Live call for the target, ending any call already in this tab.
 * Must be called from a user gesture so the remote audio may autoplay.
 * Resolves to an error message when the call could not start.
 */
export async function startVoiceCall(target: VoiceCallTarget): Promise<string | null> {
  if (active !== null || snapshot.status !== "idle") stopVoiceCall();

  // Created inside the gesture so autoplay policy lets the remote track play.
  const audio = new Audio();
  audio.autoplay = true;
  const call: ActiveCall = {
    target,
    audio,
    stream: null,
    pc: null,
    voiceSessionId: null,
    disconnectTimer: null,
  };
  active = call;
  setSnapshot({ ...IDLE_VOICE_CALL, status: "connecting", ...targetFields(target) });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    call.stream = stream;
    if (active !== call) {
      release(call);
      return null;
    }
    const micTrack = stream.getAudioTracks()[0];
    if (!micTrack) throw new Error("No microphone found");

    const pc = new RTCPeerConnection();
    call.pc = pc;
    pc.addTrack(micTrack, stream);
    // GPT-Live requires the events channel to be negotiated in the offer.
    const channel = pc.createDataChannel("oai-events");
    channel.addEventListener("message", (event) => {
      if (active !== call) return;
      setSnapshot(applyVoiceEvent(snapshot, parseVoiceEvent(event.data)));
    });
    channel.addEventListener("close", () => endFromRemote(call));
    pc.addEventListener("track", (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      void audio.play().catch(() => undefined);
    });
    watchConnection(call, pc);

    await pc.setLocalDescription(await pc.createOffer());
    await waitForIceGathering(pc);
    if (active !== call) return null;
    const sdp = pc.localDescription?.sdp;
    if (!sdp) throw new Error("Could not create a voice connection offer");

    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.startVoice,
      {
        environmentId: target.environmentId,
        input: {
          projectId: target.projectId,
          ...(target.threadId ? { threadId: target.threadId } : {}),
          sdp,
        },
      },
      { label: "voice start", reportFailure: false },
    );
    if (result._tag === "Failure") {
      if (active !== call) return null;
      throw isAtomCommandInterrupted(result)
        ? new Error("Voice call was interrupted")
        : squashAtomCommandFailure(result);
    }
    call.voiceSessionId = result.value.voiceSessionId;
    if (active !== call) {
      sendStop(call);
      return null;
    }
    setSnapshot({ ...snapshot, voiceSessionId: result.value.voiceSessionId });
    await pc.setRemoteDescription({ type: "answer", sdp: result.value.sdp });
    return null;
  } catch (error) {
    if (active !== call) return null;
    active = null;
    release(call);
    sendStop(call);
    const message = describeError(error);
    setSnapshot({ ...IDLE_VOICE_CALL, status: "error", error: message, ...targetFields(target) });
    return message;
  }
}
