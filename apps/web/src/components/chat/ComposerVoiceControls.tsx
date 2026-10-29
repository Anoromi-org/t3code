import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AudioLinesIcon, MicIcon, MicOffIcon } from "lucide-react";
import { memo } from "react";

import { serverEnvironment } from "../../state/server";
import {
  startVoiceCall,
  stopVoiceCall,
  toggleVoiceMute,
  useVoiceCall,
  voiceUnsupportedReason,
  type VoiceCallSnapshot,
} from "../../voice/voiceCall";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerBanner } from "./ComposerBanner";

interface VoiceTargetProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  // Undefined for the draft composer.
  readonly threadId: ThreadId | undefined;
}

function isCallFor(call: VoiceCallSnapshot, target: VoiceTargetProps) {
  return (
    call.status !== "idle" &&
    call.environmentId === target.environmentId &&
    call.projectId === target.projectId &&
    call.threadId === target.threadId
  );
}

const keepComposerFocus = (event: React.PointerEvent) => event.preventDefault();

async function startHere(target: VoiceTargetProps) {
  const error = await startVoiceCall({
    environmentId: target.environmentId,
    projectId: target.projectId,
    ...(target.threadId ? { threadId: target.threadId } : {}),
  });
  if (error !== null) {
    toastManager.add(
      stackedThreadToast({ type: "error", title: "Could not start voice", description: error }),
    );
  }
}

export const ComposerVoiceButton = memo(function ComposerVoiceButton(props: VoiceTargetProps) {
  const call = useVoiceCall();
  const canOperate = useAtomValue(serverEnvironment.startVoice.permissionAtom(props.environmentId));
  const unsupportedReason = voiceUnsupportedReason();
  const here = isCallFor(call, props);
  const activeHere = here && (call.status === "connecting" || call.status === "live");
  const busyElsewhere = !here && (call.status === "connecting" || call.status === "live");

  const disabledReason =
    unsupportedReason ?? (canOperate ? null : "This session cannot operate this environment");
  const tooltip =
    disabledReason ??
    (activeHere
      ? "End voice call"
      : busyElsewhere
        ? "Voice call is active in another thread. Click to move it here"
        : "Start voice call");

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={disabledReason !== null}
          aria-label={tooltip}
          aria-pressed={activeHere}
          data-pressed={activeHere ? "" : undefined}
          onPointerDown={keepComposerFocus}
          onClick={() => {
            if (activeHere) stopVoiceCall();
            else void startHere(props);
          }}
        >
          {activeHere ? <AudioLinesIcon /> : <MicIcon />}
        </Button>
      </TooltipTrigger>
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
});

function statusLabel(call: VoiceCallSnapshot) {
  switch (call.status) {
    case "connecting":
      return "Connecting…";
    case "error":
      return `Error: ${call.error ?? "Voice call failed"}`;
    default:
      return call.muted ? "Muted" : "Listening";
  }
}

export const ComposerVoiceStrip = memo(function ComposerVoiceStrip(props: VoiceTargetProps) {
  const call = useVoiceCall();
  if (!isCallFor(call, props)) return null;
  const isError = call.status === "error";

  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root
        data-chat-composer-voice-strip="true"
        variant={isError ? "error" : "default"}
      >
        <ComposerBanner.Row>
          <ComposerBanner.Icon>{call.muted ? <MicOffIcon /> : <MicIcon />}</ComposerBanner.Icon>
          <ComposerBanner.Content>
            <span className="truncate">{statusLabel(call)}</span>
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            {isError ? (
              <ComposerBanner.Dismiss aria-label="Dismiss voice error" onClick={stopVoiceCall} />
            ) : (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={call.status !== "live"}
                  onPointerDown={keepComposerFocus}
                  onClick={toggleVoiceMute}
                >
                  {call.muted ? "Unmute" : "Mute"}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost-destructive"
                  onPointerDown={keepComposerFocus}
                  onClick={stopVoiceCall}
                >
                  End
                </Button>
              </>
            )}
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        {call.userLine || call.assistantLine ? (
          <ComposerBanner.Body className="pb-1 text-muted-foreground">
            {call.userLine ? <p className="truncate">You: {call.userLine}</p> : null}
            {call.assistantLine ? <p className="truncate">Voice: {call.assistantLine}</p> : null}
          </ComposerBanner.Body>
        ) : null}
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
});
