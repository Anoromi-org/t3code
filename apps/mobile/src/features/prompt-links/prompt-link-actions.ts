import * as Dialog from "../../components/ui/Dialog";
import { buildNewThreadLink, type LinkedPrompt } from "@t3tools/shared/promptLinks";
import { msg } from "gt-react-native";

import { m } from "../../i18n/messages";

import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import {
  getComposerDraftSnapshot,
  rememberComposerDraftSelection,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { requestLinkedComposerFocus } from "./linked-composer-focus";
import { linkedThreadDraftAction } from "./prompt-link-model";

export function showPromptLinkNotice(notice: string, onDismiss?: () => void): void {
  Dialog.alert(m(msg("Prompt from a link")), notice, [{ text: m(msg("OK")), onPress: onDismiss }]);
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
): Promise<void> {
  try {
    await waitForComposerDraftsLoaded();
  } catch {
    Dialog.alert(
      m(msg("Could not open link")),
      m(msg("Drafts could not be loaded, so the prompt was not added.")),
    );
    return;
  }
  const action = linkedThreadDraftAction(getComposerDraftSnapshot(draftKey).text, prompt.text);
  // Focus waits for the dialog: the keyboard would otherwise open under it.
  const focusComposer = () => requestLinkedComposerFocus(draftKey);
  if (action !== "ask") {
    if (action === "fill") fillLinkedThreadDraft(draftKey, prompt.text);
    showPromptLinkNotice(notice, focusComposer);
    return;
  }
  Dialog.alert(m(msg("Linked prompt ready. Replace draft?")), notice, [
    { text: m(msg("Keep mine")), style: "cancel", onPress: focusComposer },
    {
      text: m(msg("Replace", { $context: "verb, replaces the draft" })),
      onPress: () => {
        fillLinkedThreadDraft(draftKey, prompt.text);
        focusComposer();
      },
    },
  ]);
}

export async function copyPromptLink(prompt: string): Promise<void> {
  if (!(await tryCopyTextWithHaptic(buildNewThreadLink({ prompt }), { target: "prompt link" }))) {
    Dialog.alert(m(msg("Could not copy")), m(msg("Try again.")));
  }
}
