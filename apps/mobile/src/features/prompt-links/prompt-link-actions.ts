import * as Dialog from "../../components/ui/Dialog";
import {
  buildNewThreadLink,
  type LinkedPrompt,
  type PromptLinkSource,
} from "@t3tools/shared/promptLinks";
import { msg } from "gt-react-native";

import { m } from "../../i18n/messages";

import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import {
  getComposerDraftSnapshot,
  rememberComposerDraftSelection,
  setComposerDraftContext,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import { requestLinkedComposerFocus } from "./linked-composer-focus";
import { linkedPromptDraft, linkedThreadDraftAction } from "./prompt-link-model";
import { isTrustedLinkKey, trustLinkSource } from "./trusted-link-sources";

interface PromptLinkNoticeRequest {
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
  const source = request.source;
  const label = source?.label;
  const trustButton =
    !trusted && request.offerTrust && source && label
      ? {
          text: m(msg("Don't ask again for {app}", { app: label })),
          onPress: () => {
            // Trusting is best effort: the link proceeds like OK even if the write fails.
            void trustLinkSource({ label, key: source.key }).catch(() => undefined);
            onDismiss?.();
          },
        }
      : null;
  Dialog.alert(m(msg("Prompt from a link")), request.notice, [
    ...(trustButton ? [trustButton] : []),
    { text: m(msg("OK")), onPress: onDismiss },
  ]);
}

function linkedPromptNoticeRequest(
  prompt: LinkedPrompt,
  notice: string,
  source: PromptLinkSource | null | undefined,
): PromptLinkNoticeRequest {
  const clean = prompt.hiddenCharacters === 0;
  return { notice, source, skippable: clean, offerTrust: clean };
}

/** Replaces the draft's text with the link's draft, chip first. */
export function fillLinkedDraft(
  draftKey: string,
  draft: ReturnType<typeof linkedPromptDraft>,
): void {
  const { text, record } = draft;
  if (record) {
    const existing = getComposerDraftSnapshot(draftKey).context?.records ?? [];
    // Setting the text next drops every record it no longer references.
    setComposerDraftContext(draftKey, {
      version: 1,
      records: [...existing.filter((entry) => entry.contextId !== record.contextId), record],
    });
  }
  setComposerDraftText(draftKey, text);
  // A composer already showing this thread clamps its caret to the old (empty) text otherwise.
  rememberComposerDraftSelection(draftKey, text, { start: text.length, end: text.length });
}

export async function applyLinkedPromptToThreadDraft(
  draftKey: string,
  prompt: LinkedPrompt,
  notice: string,
  source?: PromptLinkSource | null,
  /** The link's `from`, which names the app on its reference chip. */
  app: string | null = source?.label ?? null,
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
  const draft = linkedPromptDraft(prompt, app);
  const action = linkedThreadDraftAction(getComposerDraftSnapshot(draftKey).text, draft.text);
  // Focus waits for the dialog: the keyboard would otherwise open under it.
  const focusComposer = () => requestLinkedComposerFocus(draftKey);
  if (action !== "ask") {
    if (action === "fill") fillLinkedDraft(draftKey, draft);
    await showPromptLinkNotice(linkedPromptNoticeRequest(prompt, notice, source), focusComposer);
    return;
  }
  Dialog.alert(m(msg("Linked prompt ready. Replace draft?")), notice, [
    { text: m(msg("Keep mine")), style: "cancel", onPress: focusComposer },
    {
      text: m(msg("Replace", { $context: "verb, replaces the draft" })),
      onPress: () => {
        fillLinkedDraft(draftKey, draft);
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
