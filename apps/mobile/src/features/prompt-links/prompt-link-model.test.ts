import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";
import { parseNewThreadLink, parseThreadLinkPrompt } from "@t3tools/shared/promptLinks";
import { describe, expect, it } from "vite-plus/test";

import {
  linkedPromptDraft,
  promptLinkSearchFromParams,
  stepPendingPromptLink,
  withoutPromptLinkParams,
} from "./prompt-link-model";

describe("promptLinkSearchFromParams", () => {
  it("round-trips decoded route params into the shared parser", () => {
    const search = promptLinkSearchFromParams({
      prompt: "Fix the bug & add tests = done?",
      repo: ["pingdotgg/t3code", "ignored/second"],
      provider: "codex",
      screen: "NewTask",
    });

    expect(parseNewThreadLink(search ?? "")).toEqual({
      ok: true,
      value: {
        kind: "new",
        prompt: { text: "Fix the bug & add tests = done?", hiddenCharacters: 0 },
        repository: { owner: "pingdotgg", name: "t3code" },
        provider: "codex",
        model: null,
      },
    });
  });
});

describe("stepPendingPromptLink", () => {
  const waiting = "repo=t3tools%2Ft3code";

  it("drops a link whose screen is missing from the first state after it was parsed", () => {
    expect(stepPendingPromptLink(waiting, { screenOnStack: false, ready: true })).toEqual({
      pending: null,
      resolve: null,
    });
  });

  it("holds a link on its screen until its target is ready, then resolves it once", () => {
    expect(stepPendingPromptLink(waiting, { screenOnStack: true, ready: false })).toEqual({
      pending: waiting,
      resolve: null,
    });
    expect(stepPendingPromptLink(waiting, { screenOnStack: true, ready: true })).toEqual({
      pending: null,
      resolve: waiting,
    });
  });

  it("drops a link whose screen was left before its target was ready", () => {
    expect(stepPendingPromptLink(waiting, { screenOnStack: false, ready: false })).toEqual({
      pending: null,
      resolve: null,
    });
  });
});

describe("withoutPromptLinkParams", () => {
  it("keeps the route's other params", () => {
    expect(withoutPromptLinkParams({ prompt: "hi", repo: "a/b", incomingShareId: "1" })).toEqual({
      incomingShareId: "1",
    });
  });
});

describe("linkedPromptDraft", () => {
  const reference = {
    title: "LR parsing · Items",
    url: "learningapps://open/learn-lr-game",
    details: [
      { name: "lesson", value: "3" },
      { name: "stack", value: "E + n" },
    ],
  };

  it("leaves a plain prompt alone", () => {
    expect(linkedPromptDraft({ text: "Fix it", hiddenCharacters: 0 }, "Learning")).toEqual({
      text: "Fix it",
      record: null,
    });
  });

  it("puts the reference chip and one space in front of the prompt", () => {
    const { text, record } = linkedPromptDraft(
      { text: "Why?", hiddenCharacters: 0, reference },
      "Learning",
    );
    expect(record).toMatchObject({
      kind: "app-reference",
      label: "LR parsing · Items",
      app: "Learning",
      url: "learningapps://open/learn-lr-game",
      details: reference.details,
    });
    expect(record?.contextId).toMatch(/^app-reference_[0-9a-f]{16}$/);
    expect(text).toBe(
      `[LR parsing · Items](t3-context://v1/app-reference/${record?.contextId}) Why?`,
    );
    expect(collectComposerContextReferences(text).map((ref) => ref.contextId)).toEqual([
      record?.contextId,
    ]);
  });

  it("drafts just the chip for a reference-only link, ready to type after", () => {
    const parsed = parseThreadLinkPrompt(`?ref=${encodeURIComponent('{"title":"Items"}')}`);
    if (!parsed.ok || parsed.value === null) throw new Error("expected a reference");
    const { text, record } = linkedPromptDraft(parsed.value, null);
    expect(record?.app).toBeNull();
    expect(text.endsWith(") ")).toBe(true);
  });

  it("gives the same reference the same chip, and a different one another", () => {
    const id = (app: string | null, title = reference.title) =>
      linkedPromptDraft({ text: "", hiddenCharacters: 0, reference: { ...reference, title } }, app)
        .record?.contextId;
    expect(id("Learning")).toBe(id("Learning"));
    expect(id("Learning")).not.toBe(id("Learning", "LR parsing · Goto"));
    expect(id("Learning")).not.toBe(id(null));
  });
});
