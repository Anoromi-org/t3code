import type { AlertButton } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const drafts = vi.hoisted(() => ({
  text: new Map<string, string>(),
  selection: new Map<string, { text: string; start: number; end: number }>(),
}));
const alerts = vi.hoisted(() => [] as Array<{ title: string; buttons: AlertButton[] }>);

vi.mock("../../components/ui/Dialog", () => ({
  alert: (title: string, _message: string, buttons: AlertButton[] = []) => {
    alerts.push({ title, buttons });
  },
}));
vi.mock("../../lib/copyTextWithHaptic", () => ({ tryCopyTextWithHaptic: vi.fn() }));
vi.mock("../../state/use-composer-drafts", () => ({
  waitForComposerDraftsLoaded: async () => undefined,
  getComposerDraftSnapshot: (key: string) => ({ text: drafts.text.get(key) ?? "" }),
  setComposerDraftText: (key: string, text: string) => drafts.text.set(key, text),
  rememberComposerDraftSelection: (
    key: string,
    text: string,
    selection: { start: number; end: number },
  ) => drafts.selection.set(key, { text, ...selection }),
}));

import { requestLinkedComposerFocus, takeLinkedComposerFocus } from "./linked-composer-focus";
import { applyLinkedPromptToThreadDraft } from "./prompt-link-actions";

const KEY = "env:thread";
const PROMPT = { text: "[lesson 3 · round 2] ", hiddenCharacters: 0 };

function press(text: string) {
  const button = alerts.at(-1)?.buttons.find((candidate) => candidate.text === text);
  if (!button) throw new Error(`No "${text}" button`);
  button.onPress?.();
}

beforeEach(() => {
  drafts.text.clear();
  drafts.selection.clear();
  alerts.length = 0;
  takeLinkedComposerFocus(KEY);
});

describe("applyLinkedPromptToThreadDraft", () => {
  it("fills an empty draft with the caret at the end and focuses once the notice closes", async () => {
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice");

    expect(drafts.text.get(KEY)).toBe(PROMPT.text);
    expect(drafts.selection.get(KEY)).toEqual({
      text: PROMPT.text,
      start: PROMPT.text.length,
      end: PROMPT.text.length,
    });
    expect(takeLinkedComposerFocus(KEY)).toBe(false);

    press("OK");
    expect(takeLinkedComposerFocus(KEY)).toBe(true);
  });

  it("focuses after either answer when the draft already has other text", async () => {
    drafts.text.set(KEY, "my notes");
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice");
    press("Keep mine");
    expect(drafts.text.get(KEY)).toBe("my notes");
    expect(takeLinkedComposerFocus(KEY)).toBe(true);

    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice");
    press("Replace");
    expect(drafts.text.get(KEY)).toBe(PROMPT.text);
    expect(drafts.selection.get(KEY)?.end).toBe(PROMPT.text.length);
    expect(takeLinkedComposerFocus(KEY)).toBe(true);
  });
});

describe("linked composer focus", () => {
  it("keeps a request for a composer that mounts later, for that draft only, once", () => {
    requestLinkedComposerFocus(KEY);
    expect(takeLinkedComposerFocus("env:other")).toBe(false);
    expect(takeLinkedComposerFocus(KEY)).toBe(true);
    expect(takeLinkedComposerFocus(KEY)).toBe(false);
  });
});
