import * as NodeCrypto from "node:crypto";
import type { AlertButton } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const drafts = vi.hoisted(() => ({
  text: new Map<string, string>(),
  selection: new Map<string, { text: string; start: number; end: number }>(),
}));
const alerts = vi.hoisted(
  () => [] as Array<{ title: string; message: string; buttons: AlertButton[] }>,
);
const secureStore = vi.hoisted(() => new Map<string, string>());

vi.mock("../../components/ui/Dialog", () => ({
  alert: (title: string, message: string, buttons: AlertButton[] = []) => {
    alerts.push({ title, message, buttons });
  },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void secureStore.set(key, value),
}));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    NodeCrypto.createHash("sha256").update(value).digest("hex"),
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
import {
  hashLinkKey,
  removeTrustedLinkSource,
  resetTrustedLinkSourcesForTest,
} from "./trusted-link-sources";

const KEY = "env:thread";
const PROMPT = { text: "[lesson 3 · round 2] ", hiddenCharacters: 0 };

function press(text: string) {
  const button = alerts.at(-1)?.buttons.find((candidate) => candidate.text === text);
  if (!button) throw new Error(`No "${text}" button`);
  button.onPress?.();
}

const SOURCE = { label: "Learning", key: "AbC-_9xyz012345678901w" };
const TRUST = "Don't ask again for Learning";

beforeEach(() => {
  secureStore.clear();
  resetTrustedLinkSourcesForTest();
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

describe("trusted link sources", () => {
  it("offers to trust a named source, then skips the notice and focuses at once", async () => {
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice", SOURCE);
    expect(alerts.at(-1)?.title).toBe("Prompt from a link");
    expect(alerts.at(-1)?.buttons.map((button) => button.text)).toEqual([TRUST, "OK"]);
    press(TRUST);
    expect(takeLinkedComposerFocus(KEY)).toBe(true);
    await vi.waitFor(() => expect(secureStore.size).toBe(1));
    const stored = [...secureStore.values()].join("");
    expect(stored).not.toContain(SOURCE.key);
    expect(stored).toContain(await hashLinkKey(SOURCE.key));

    drafts.text.clear();
    alerts.length = 0;
    resetTrustedLinkSourcesForTest();
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice", SOURCE);
    expect(alerts).toEqual([]);
    expect(drafts.text.get(KEY)).toBe(PROMPT.text);
    expect(takeLinkedComposerFocus(KEY)).toBe(true);
  });

  it("offers nothing without a key or name, or under a hidden-characters warning", async () => {
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice");
    expect(alerts.at(-1)?.buttons.map((button) => button.text)).toEqual(["OK"]);
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice", { ...SOURCE, label: null });
    expect(alerts.at(-1)?.buttons.map((button) => button.text)).toEqual(["OK"]);
    const hidden = { ...PROMPT, hiddenCharacters: 2 };
    await applyLinkedPromptToThreadDraft(KEY, hidden, "notice", SOURCE);
    expect(alerts.at(-1)?.buttons.map((button) => button.text)).toEqual(["OK"]);
  });

  it("still warns about hidden characters from a trusted source, and forgets removed ones", async () => {
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice", SOURCE);
    press(TRUST);
    takeLinkedComposerFocus(KEY);
    await vi.waitFor(() => expect(secureStore.size).toBe(1));
    alerts.length = 0;
    drafts.text.clear();

    await applyLinkedPromptToThreadDraft(KEY, { ...PROMPT, hiddenCharacters: 1 }, "hidden", SOURCE);
    expect(alerts.map((alert) => alert.message)).toEqual(["hidden"]);
    expect(takeLinkedComposerFocus(KEY)).toBe(false);
    press("OK");
    expect(takeLinkedComposerFocus(KEY)).toBe(true);

    await removeTrustedLinkSource(await hashLinkKey(SOURCE.key));
    resetTrustedLinkSourcesForTest();
    alerts.length = 0;
    drafts.text.clear();
    await applyLinkedPromptToThreadDraft(KEY, PROMPT, "notice", SOURCE);
    expect(alerts.at(-1)?.buttons.map((button) => button.text)).toEqual([TRUST, "OK"]);
  });
});
