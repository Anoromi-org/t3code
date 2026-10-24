import { describe, expect, it } from "vite-plus/test";

import {
  buildNewThreadLink,
  parseNewThreadLink,
  parsePromptLinkFrom,
  parsePromptLinkSource,
  parseThreadLinkPrompt,
  promptLinkAppPath,
  promptLinkDeepLink,
  sanitizeLinkedPrompt,
  withoutPromptLinkParams,
} from "./promptLinks.ts";

describe("sanitizeLinkedPrompt", () => {
  it("removes characters a reader cannot see and counts them", () => {
    const tagged = "rate me" + String.fromCodePoint(0xe0041, 0xe0042);
    expect(sanitizeLinkedPrompt(`a\u200Bb\u202Ec\uFEFF${tagged}`)).toEqual({
      text: "abcrate me",
      hiddenCharacters: 5,
    });
    expect(sanitizeLinkedPrompt("a\u2028b\u2029c")).toEqual({
      text: "a\nb\nc",
      hiddenCharacters: 0,
    });
  });

  it("keeps one trailing space after the text, and nothing else around it", () => {
    expect(sanitizeLinkedPrompt("[lesson 3 · x] ").text).toBe("[lesson 3 · x] ");
    expect(sanitizeLinkedPrompt("  hi   ").text).toBe("hi ");
    expect(sanitizeLinkedPrompt("\nhi\n").text).toBe("hi");
    expect(sanitizeLinkedPrompt("   ").text).toBe("");
  });

  it("keeps emoji sequences intact", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const heart = "\u2764\uFE0F";
    expect(sanitizeLinkedPrompt(`${family} ${heart}`)).toEqual({
      text: `${family} ${heart}`,
      hiddenCharacters: 0,
    });
    expect(sanitizeLinkedPrompt("a\u200Db").hiddenCharacters).toBe(1);
    expect(sanitizeLinkedPrompt("\u{1F468}\u200D").hiddenCharacters).toBe(1);
    expect(sanitizeLinkedPrompt("\u{20000}\u200D\u{20001}").hiddenCharacters).toBe(1);
  });
});

describe("parseNewThreadLink", () => {
  it("reads a shared prompt with its optional repository and model", () => {
    const result = parseNewThreadLink(
      "?prompt=Rate+me&repo=https://github.com/pingdotgg/t3code.git&provider=Codex&model=gpt-5",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "new",
        prompt: { text: "Rate me", hiddenCharacters: 0 },
        repository: { owner: "pingdotgg", name: "t3code" },
        provider: "codex",
        model: "gpt-5",
      },
    });
  });

  it("reads a pull request link, whose prompt is optional", () => {
    for (const pr of [
      "pingdotgg/t3code/42",
      "pingdotgg/t3code%2342",
      "https://github.com/pingdotgg/t3code/pull/42/files",
    ]) {
      expect(parseNewThreadLink(`?pr=${pr}`)).toEqual({
        ok: true,
        value: {
          kind: "pull-request",
          pullRequest: { owner: "pingdotgg", name: "t3code", number: 42 },
          prompt: null,
        },
      });
    }
  });

  it("refuses links it cannot open safely", () => {
    expect(parseNewThreadLink("?repo=a/b").ok).toBe(false);
    expect(parseNewThreadLink("?prompt=%E2%80%8B").ok).toBe(false);
    expect(parseThreadLinkPrompt("?prompt=%E2%80%8B").ok).toBe(false);
    expect(parseNewThreadLink("?prompt=x&repo=../etc").ok).toBe(false);
    expect(parseNewThreadLink(`?prompt=${"x".repeat(8_001)}`).ok).toBe(false);
  });
});

describe("thread links", () => {
  it("reads the prompt and leaves other parameters in place", () => {
    expect(parseThreadLinkPrompt("?prompt=Fix+it")).toEqual({
      ok: true,
      value: { text: "Fix it", hiddenCharacters: 0 },
    });
    expect(parseThreadLinkPrompt("?panel=diff")).toEqual({ ok: true, value: null });
    expect(withoutPromptLinkParams("?prompt=x&panel=diff")).toBe("?panel=diff");
  });
});

describe("link sources", () => {
  const KEY = "AbC-_9xyz012345678901w";

  it("keeps from and key out of the prompt and hands them over separately", () => {
    const search = `?prompt=%5Blesson%203%5D%20&from=Learning&key=${KEY}`;
    expect(parseThreadLinkPrompt(search)).toEqual({
      ok: true,
      value: { text: "[lesson 3] ", hiddenCharacters: 0 },
    });
    expect(parsePromptLinkSource(search)).toEqual({ label: "Learning", key: KEY });
    const link = parseNewThreadLink(`?prompt=Fix+it&from=Learning&key=${KEY}`);
    expect(link.ok && link.value.kind === "new" && link.value.prompt.text).toBe("Fix it");
    expect(withoutPromptLinkParams(`?prompt=x&from=Learning&key=${KEY}&panel=diff`)).toBe(
      "?panel=diff",
    );
  });

  it("ignores missing or malformed keys and cleans the label", () => {
    expect(parsePromptLinkSource("?prompt=x&from=Learning")).toBeNull();
    expect(parsePromptLinkSource("?prompt=x&key=short")).toBeNull();
    expect(parsePromptLinkSource(`?key=${KEY}%20x`)).toBeNull();
    expect(parsePromptLinkSource(`?key=${KEY}`)).toEqual({ label: null, key: KEY });
    expect(parsePromptLinkSource(`?from=%20Le%E2%80%8Barn%0Aing%20&key=${KEY}`)?.label).toBe(
      "Learn ing",
    );
    const long = parsePromptLinkSource(`?from=${"x".repeat(80)}&key=${KEY}`)?.label;
    expect(long).toBe(`${"x".repeat(31)}…`);
  });
});

describe("app references", () => {
  const ref = (value: unknown) =>
    `ref=${encodeURIComponent(typeof value === "string" ? value : JSON.stringify(value))}`;
  const lesson = {
    title: "LR parsing · Items",
    url: "learningapps://open/learn-lr-game",
    details: [
      ["lesson", "3"],
      ["stack", "E + n"],
    ],
  };
  const failure = (search: string) => {
    const parsed = parseThreadLinkPrompt(search);
    return parsed.ok ? null : parsed.error;
  };

  it("reads a reference next to the prompt", () => {
    expect(parseThreadLinkPrompt(`?prompt=Why%3F&from=Learning&${ref(lesson)}`)).toEqual({
      ok: true,
      value: {
        text: "Why?",
        hiddenCharacters: 0,
        reference: {
          title: "LR parsing · Items",
          url: "learningapps://open/learn-lr-game",
          details: [
            { name: "lesson", value: "3" },
            { name: "stack", value: "E + n" },
          ],
        },
      },
    });
    expect(parsePromptLinkFrom(`?from=Learning&${ref(lesson)}`)).toBe("Learning");
    expect(withoutPromptLinkParams(`?${ref(lesson)}&panel=diff`)).toBe("?panel=diff");
  });

  it("opens a reference without a prompt, on thread and new-thread links", () => {
    expect(parseThreadLinkPrompt(`?${ref({ title: "Items" })}`)).toEqual({
      ok: true,
      value: {
        text: "",
        hiddenCharacters: 0,
        reference: { title: "Items", url: null, details: [] },
      },
    });
    const link = parseNewThreadLink(`?${ref({ title: "Items" })}`);
    expect(link.ok && link.value.kind === "new" && link.value.prompt.reference?.title).toBe(
      "Items",
    );
  });

  it("counts hidden characters from the reference toward the link's warning", () => {
    const parsed = parseThreadLinkPrompt(
      `?prompt=Hi%E2%80%8B&${ref({ title: "It\u200Bems", details: [["st\u202Eack", "E\u2060"]] })}`,
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      text: "Hi",
      hiddenCharacters: 4,
      reference: { title: "Items", details: [{ name: "stack", value: "E" }] },
    });
  });

  it("refuses malformed references with a reason", () => {
    expect(failure("?ref=%7Btitle")).toMatch(/not valid JSON/);
    expect(failure(`?${ref(["x"])}`)).toMatch(/not a JSON object/);
    expect(failure(`?${ref({ url: "https://x.dev" })}`)).toMatch(/no title/);
    expect(failure(`?${ref({ title: " \u200B " })}`)).toMatch(/empty title/);
    expect(failure(`?${ref({ title: "x".repeat(121) })}`)).toMatch(/longer than 120/);
    expect(
      failure(`?${ref({ title: "x", details: Array.from({ length: 13 }, () => ["a", "b"]) })}`),
    ).toMatch(/more than 12 details/);
    expect(failure(`?${ref({ title: "x", details: [["a", 1]] })}`)).toMatch(/pair of text/);
    expect(failure(`?${ref({ title: "x", details: [["n".repeat(41), "v"]] })}`)).toMatch(
      /name longer than 40/,
    );
    expect(failure(`?${ref({ title: "x", details: [["n", "v".repeat(201)]] })}`)).toMatch(
      /value longer than 200/,
    );
  });

  it("only keeps links back into an app", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,x",
      "file:///etc",
    ]) {
      expect(failure(`?${ref({ title: "x", url })}`)).toMatch(/does not open/);
    }
    for (const url of [
      "learn-lr-game",
      "/open/x",
      "learningapps://open x",
      "https://x.dev/\u200B",
    ]) {
      expect(failure(`?${ref({ title: "x", url })}`)).toMatch(/cannot open/);
    }
    expect(failure(`?${ref({ title: "x", url: `https://x.dev/${"a".repeat(2_048)}` })}`)).toMatch(
      /link longer than 2048/,
    );
    const https = parseThreadLinkPrompt(`?${ref({ title: "x", url: "https://learn.dev/a?b=1" })}`);
    expect(https.ok && https.value?.reference?.url).toBe("https://learn.dev/a?b=1");
  });
});

describe("link round trips", () => {
  it("builds a link that parses back to the same prompt", () => {
    const link = buildNewThreadLink({
      prompt: "Swear count & rating?",
      repository: { owner: "pingdotgg", name: "t3code" },
      provider: "claudeAgent",
      model: "opus",
    });
    const path = promptLinkAppPath(link);
    expect(path).toBe(new URL(link).pathname + new URL(link).search);
    const parsed = parseNewThreadLink(new URL(link).search);
    expect(parsed.ok && parsed.value.kind === "new" && parsed.value.prompt.text).toBe(
      "Swear count & rating?",
    );
  });

  it("maps app scheme and hosted links to in-app paths, and nothing else", () => {
    expect(promptLinkAppPath("t3code://new?prompt=hi")).toBe("/new?prompt=hi");
    expect(promptLinkAppPath("t3code-dev://threads/env-1/thread-1")).toBe("/env-1/thread-1");
    expect(promptLinkAppPath("https://app.t3.codes/env-1/thread-1?prompt=go")).toBe(
      "/env-1/thread-1?prompt=go",
    );
    expect(promptLinkAppPath("https://app.t3.codes/settings/general")).toBeNull();
    expect(promptLinkAppPath("https://evil.test/new?prompt=hi")).toBeNull();
    expect(promptLinkAppPath("t3code://app/index.html")).toBeNull();
  });

  it("hands an in-app path to the installed app", () => {
    expect(promptLinkDeepLink("/new?prompt=hi")).toBe("t3code://new?prompt=hi");
    expect(promptLinkDeepLink("/env-1/thread-1?prompt=hi")).toBe(
      "t3code://threads/env-1/thread-1?prompt=hi",
    );
  });
});
