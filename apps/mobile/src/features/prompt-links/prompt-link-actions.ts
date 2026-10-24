import * as Dialog from "../../components/ui/Dialog";
import {
  buildNewThreadLink,
  type LinkedPrompt,
  type PromptLinkSource,
} from "@t3tools/shared/promptLinks";

import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import {
  getComposerDraftSnapshot,
  rememberComposerDraftSelection,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { requestLinkedComposerFocus } from "./linked-composer-focus";
import { linkedThreadDraftAction } from "./prompt-link-model";
import { isTrustedLinkKey, trustLinkSource } from "./trusted-link-sources";

export interface PromptLinkNoticeRequest {
  readonly notice: string;
  /** From the link. Absent for links that did not name their app. */
  readonly source?: PromptLinkSource | null;
  /**
   * Whether a trusted source may skip the notice. False when it carries a warning (hidden
   * characters) or news the user needs (an unavailable model or pull request).
   */
  readonly skippable: boolean;
  /** Whether the notice may offer to trust the source. False with a hidden-characters warning. */
  readonly offerTrust: boolean;
}

async function isTrusted(source: PromptLinkSource | null | undefined): Promise<boolean> {
  if (!source) return false;
  try {
    return await isTrustedLinkKey(source.key);
  } catch {
    return false;
  }
}

export async function showPromptLinkNotice(
  request: PromptLinkNoticeRequest,
  onDismiss?: () => void,
): Promise<void> {
  const trusted = await isTrusted(request.source);
  if (trusted && request.skippable) {
    onDismiss?.();
    return;
  }
  const label = request.source?.label;
  const trustButton =
    !trusted && request.offerTrust && request.source && label
      ? {
          text: `Don't ask again for ${label}`,
          onPress: () => {
            const { key } = request.source!;
            // Trusting is best effort: the link proceeds like OK even if the write fails.
            void trustLinkSource({ label, key }).catch(() => undefined);
            onDismiss?.();
          },
        }
      : null;
  Dialog.alert("Prompt from a link", request.notice, [
    ...(trustButton ? [trustButton] : []),
    { text: "OK", onPress: onDismiss },
  ]);
}

export function linkedPromptNoticeRequest(
  prompt: LinkedPrompt,
  notice: string,
  source: PromptLinkSource | null | undefined,
): PromptLinkNoticeRequest {
  const clean = prompt.hiddenCharacters === 0;
  return { notice, source, skippable: clean, offerTrust: clean };
}

function fillLinkedThreadDraft(draftKey: string, text: string): void {
  setComposerDraftText(draftKey, text);
  // A composer already showing this thread clamps its caret to the old (empty) text otherwise.
  rememberComposerDraftSelection(draftKey, text, { start: text.length, end: text.length });
}

export async function applyLinkedPromptToThreadDraft(
  draftKey: string,
  prompt: LinkedPrompt,
  notice: string,
  source?: PromptLinkSource | null,
): Promise<void> {
  try {
    await waitForComposerDraftsLoaded();
  } catch {
    Dialog.alert("Could not open link", "Drafts could not be loaded, so the prompt was not added.");
    return;
  }
  const action = linkedThreadDraftAction(getComposerDraftSnapshot(draftKey).text, prompt.text);
  // Focus waits for the dialog: the keyboard would otherwise open under it.
  const focusComposer = () => requestLinkedComposerFocus(draftKey);
  if (action !== "ask") {
    if (action === "fill") fillLinkedThreadDraft(draftKey, prompt.text);
    await showPromptLinkNotice(linkedPromptNoticeRequest(prompt, notice, source), focusComposer);
    return;
  }
  Dialog.alert("Linked prompt ready. Replace draft?", notice, [
    { text: "Keep mine", style: "cancel", onPress: focusComposer },
    {
      text: "Replace",
      onPress: () => {
        fillLinkedThreadDraft(draftKey, prompt.text);
        focusComposer();
      },
    },
  ]);
}

export async function copyPromptLink(prompt: string): Promise<void> {
  if (!(await tryCopyTextWithHaptic(buildNewThreadLink({ prompt }), { target: "prompt link" }))) {
    Dialog.alert("Could not copy", "Try again.");
  }
}
