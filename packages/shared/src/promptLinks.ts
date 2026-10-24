import {
  APP_REFERENCE_DETAIL_NAME_MAX_CHARS,
  APP_REFERENCE_DETAIL_VALUE_MAX_CHARS,
  APP_REFERENCE_MAX_DETAILS,
  APP_REFERENCE_TITLE_MAX_CHARS,
  APP_REFERENCE_URL_MAX_CHARS,
} from "@t3tools/contracts";

import { DEFAULT_HOSTED_APP_URL } from "./connectAuth.ts";

export const PROMPT_LINK_MAX_PROMPT_LENGTH = 8_000;

export interface PromptLinkRepository {
  readonly owner: string;
  readonly name: string;
}

export interface PromptLinkPullRequest extends PromptLinkRepository {
  readonly number: number;
}

export interface PromptLinkReference {
  readonly title: string;
  readonly url: string | null;
  readonly details: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

export interface LinkedPrompt {
  /** Empty when the link carried only a reference. */
  readonly text: string;
  /** Includes those removed from the reference. */
  readonly hiddenCharacters: number;
  /** Where the user was in the linking app, from `ref`. Clients show it as one context chip. */
  readonly reference?: PromptLinkReference;
}

export type NewThreadLink =
  | {
      readonly kind: "new";
      readonly prompt: LinkedPrompt;
      readonly repository: PromptLinkRepository | null;
      readonly provider: string | null;
      readonly model: string | null;
    }
  | {
      readonly kind: "pull-request";
      readonly pullRequest: PromptLinkPullRequest;
      readonly prompt: LinkedPrompt | null;
    };

export type PromptLinkResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

// Zero-width and bidi controls, tag and variation-selector blocks, and other characters that
// render as nothing. A model reads them; the person checking the draft cannot see them, which
// makes them the usual way to hide instructions in a prompt.
const HIDDEN_CHARACTERS =
  // oxlint-disable-next-line no-control-regex, no-misleading-character-class -- these are the characters it removes.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF0-\uFFFB\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;
// Emoji and the pieces emoji sequences are built from: pictographs, symbols, skin tones, and the
// emoji presentation selector. Numeric ranges, because Hermes lacks Unicode property escapes.
const isEmojiPart = (codePoint: number | undefined) =>
  codePoint !== undefined &&
  ((codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2190 && codePoint <= 0x2bff) ||
    codePoint === 0xfe0f);

export function sanitizeLinkedPrompt(raw: string): LinkedPrompt {
  let hiddenCharacters = 0;
  const visible = Array.from(
    raw.replace(/\r\n?|[\u2028\u2029]/g, "\n").replace(HIDDEN_CHARACTERS, () => {
      hiddenCharacters++;
      return "";
    }),
  );
  const text = visible
    .filter((character, index) => {
      if (character !== "\u200D") return true;
      const kept =
        isEmojiPart(visible[index - 1]?.codePointAt(0)) &&
        isEmojiPart(visible[index + 1]?.codePointAt(0));
      if (!kept) hiddenCharacters++;
      return kept;
    })
    .join("");
  const body = text.trim();
  // Apps prefill a citation like "[lesson 3 · …] " so the caret lands after it; keep that one space.
  return { text: body && text.endsWith(" ") ? `${body} ` : body, hiddenCharacters };
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

function repositoryOf(owner: string, name: string): PromptLinkRepository | null {
  const trimmedName = name.replace(/\.git$/i, "");
  if (!OWNER.test(owner) || !NAME.test(trimmedName) || /^\.+$/.test(trimmedName)) return null;
  return { owner, name: trimmedName };
}

export function parsePromptLinkRepository(value: string): PromptLinkRepository | null {
  const trimmed = value.trim();
  const url = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/?$/i.exec(trimmed);
  const short = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  const match = url ?? short;
  return match?.[1] && match[2] ? repositoryOf(match[1], match[2]) : null;
}

function parsePromptLinkPullRequest(value: string): PromptLinkPullRequest | null {
  const trimmed = value.trim();
  const match =
    /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(
      trimmed,
    ) ?? /^([^/\s#]+)\/([^/\s#]+)(?:\/|#)(\d+)$/.exec(trimmed);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const repository = repositoryOf(match[1], match[2]);
  const number = Number(match[3]);
  return repository && Number.isSafeInteger(number) && number > 0
    ? { ...repository, number }
    : null;
}

export function promptLinkPullRequestUrl(pullRequest: PromptLinkPullRequest): string {
  return `https://github.com/${pullRequest.owner}/${pullRequest.name}/pull/${pullRequest.number}`;
}

function readPromptText(params: URLSearchParams): PromptLinkResult<LinkedPrompt | null> {
  const raw = params.get("prompt");
  if (raw === null) return { ok: true, value: null };
  if (raw.length > PROMPT_LINK_MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `This prompt is longer than ${PROMPT_LINK_MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters, so T3 Code did not open it.`,
    };
  }
  const prompt = sanitizeLinkedPrompt(raw);
  if (prompt.text.length === 0 && prompt.hiddenCharacters > 0) {
    return {
      ok: false,
      error:
        "This prompt had only hidden characters, so it may be malicious. T3 Code did not open it.",
    };
  }
  return { ok: true, value: prompt.text.length > 0 ? prompt : null };
}

const PROMPT_LINK_MAX_REFERENCE_LENGTH = 16_000;
// A scheme and something after it. `javascript:` and friends run or embed content instead of
// opening the app that sent the link.
const REFERENCE_URL = /^([a-z][a-z0-9+.-]*):\S+$/i;
const BLOCKED_REFERENCE_SCHEMES = new Set(["javascript", "data", "file", "vbscript", "blob"]);

const referenceError = (problem: string): { readonly ok: false; readonly error: string } => ({
  ok: false,
  error: `This link's app reference ${problem}, so T3 Code did not open it.`,
});

function readReference(params: URLSearchParams): PromptLinkResult<{
  readonly reference: PromptLinkReference;
  readonly hiddenCharacters: number;
} | null> {
  const raw = params.get("ref");
  if (raw === null) return { ok: true, value: null };
  if (raw.length > PROMPT_LINK_MAX_REFERENCE_LENGTH) return referenceError("is too long");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return referenceError("is not valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return referenceError("is not a JSON object");
  }
  const input = value as Record<string, unknown>;
  let hiddenCharacters = 0;
  const visible = (text: string) => {
    const sanitized = sanitizeLinkedPrompt(text);
    hiddenCharacters += sanitized.hiddenCharacters;
    return sanitized.text.replace(/\s+/g, " ").trim();
  };

  if (typeof input.title !== "string") return referenceError("has no title");
  const title = visible(input.title);
  if (title.length === 0) return referenceError("has an empty title");
  if (title.length > APP_REFERENCE_TITLE_MAX_CHARS) {
    return referenceError(`has a title longer than ${APP_REFERENCE_TITLE_MAX_CHARS} characters`);
  }

  let url: string | null = null;
  if (input.url !== undefined && input.url !== null) {
    if (typeof input.url !== "string") return referenceError("has a link that is not text");
    url = input.url.trim() || null;
  }
  if (url !== null) {
    if (url.length > APP_REFERENCE_URL_MAX_CHARS) {
      return referenceError(`has a link longer than ${APP_REFERENCE_URL_MAX_CHARS} characters`);
    }
    const scheme = REFERENCE_URL.exec(url)?.[1]?.toLowerCase();
    if (scheme === undefined || sanitizeLinkedPrompt(url).text !== url) {
      return referenceError("has a link T3 Code cannot open");
    }
    if (BLOCKED_REFERENCE_SCHEMES.has(scheme)) {
      return referenceError(`has a ${scheme}: link, which T3 Code does not open`);
    }
  }

  const details: Array<{ readonly name: string; readonly value: string }> = [];
  if (input.details !== undefined) {
    if (!Array.isArray(input.details)) return referenceError("has details that are not a list");
    if (input.details.length > APP_REFERENCE_MAX_DETAILS) {
      return referenceError(`has more than ${APP_REFERENCE_MAX_DETAILS} details`);
    }
    for (const detail of input.details as ReadonlyArray<unknown>) {
      if (
        !Array.isArray(detail) ||
        detail.length !== 2 ||
        typeof detail[0] !== "string" ||
        typeof detail[1] !== "string"
      ) {
        return referenceError("has a detail that is not a [name, value] pair of text");
      }
      const name = visible(detail[0]);
      const text = visible(detail[1]);
      if (name.length === 0) return referenceError("has a detail without a name");
      if (name.length > APP_REFERENCE_DETAIL_NAME_MAX_CHARS) {
        return referenceError(
          `has a detail name longer than ${APP_REFERENCE_DETAIL_NAME_MAX_CHARS} characters`,
        );
      }
      if (text.length > APP_REFERENCE_DETAIL_VALUE_MAX_CHARS) {
        return referenceError(
          `has a detail value longer than ${APP_REFERENCE_DETAIL_VALUE_MAX_CHARS} characters`,
        );
      }
      details.push({ name, value: text });
    }
  }
  return { ok: true, value: { reference: { title, url, details }, hiddenCharacters } };
}

function readPrompt(params: URLSearchParams): PromptLinkResult<LinkedPrompt | null> {
  const prompt = readPromptText(params);
  if (!prompt.ok) return prompt;
  const reference = readReference(params);
  if (!reference.ok) return reference;
  if (reference.value === null) return prompt;
  return {
    ok: true,
    value: {
      text: prompt.value?.text ?? "",
      hiddenCharacters: (prompt.value?.hiddenCharacters ?? 0) + reference.value.hiddenCharacters,
      reference: reference.value.reference,
    },
  };
}

const optionalParam = (params: URLSearchParams, key: string) => params.get(key)?.trim() || null;

export function parseNewThreadLink(search: string): PromptLinkResult<NewThreadLink> {
  const params = new URLSearchParams(search);
  const prompt = readPrompt(params);
  if (!prompt.ok) return prompt;
  const pr = params.get("pr");
  if (pr !== null) {
    const pullRequest = parsePromptLinkPullRequest(pr);
    if (pullRequest === null) {
      return { ok: false, error: "This link names a pull request T3 Code cannot read." };
    }
    return { ok: true, value: { kind: "pull-request", pullRequest, prompt: prompt.value } };
  }
  if (prompt.value === null) return { ok: false, error: "This link has no prompt." };
  const repo = params.get("repo");
  const repository = repo === null ? null : parsePromptLinkRepository(repo);
  if (repo !== null && repository === null) {
    return { ok: false, error: "This link names a repository T3 Code cannot read." };
  }
  return {
    ok: true,
    value: {
      kind: "new",
      prompt: prompt.value,
      repository,
      provider: optionalParam(params, "provider")?.toLowerCase() ?? null,
      model: optionalParam(params, "model"),
    },
  };
}

export function parseThreadLinkPrompt(search: string): PromptLinkResult<LinkedPrompt | null> {
  return readPrompt(new URLSearchParams(search));
}

export interface PromptLinkSource {
  /** Display only; anyone can write any `from`. */
  readonly label: string | null;
  /** Secret the linking app keeps. Store a hash, never this. */
  readonly key: string;
}

const PROMPT_LINK_SOURCE_LABEL_MAX = 32;
const PROMPT_LINK_SOURCE_KEY = /^[A-Za-z0-9_-]{16,256}$/;

/** The link's `from`, cleaned for display. Anyone can write any `from`. */
export function parsePromptLinkFrom(search: string): string | null {
  const from = sanitizeLinkedPrompt(new URLSearchParams(search).get("from") ?? "")
    .text.replace(/\s+/g, " ")
    .trim();
  if (from.length === 0) return null;
  const characters = Array.from(from);
  return characters.length > PROMPT_LINK_SOURCE_LABEL_MAX
    ? `${characters
        .slice(0, PROMPT_LINK_SOURCE_LABEL_MAX - 1)
        .join("")
        .trimEnd()}…`
    : from;
}

// `from` and `key` identify the app that built a link so a client can trust it. They are never
// part of the prompt.
export function parsePromptLinkSource(search: string): PromptLinkSource | null {
  const key = new URLSearchParams(search).get("key");
  if (key === null || !PROMPT_LINK_SOURCE_KEY.test(key)) return null;
  return { label: parsePromptLinkFrom(search), key };
}

export const PROMPT_LINK_PARAMS = [
  "prompt",
  "repo",
  "pr",
  "provider",
  "model",
  "from",
  "key",
  "ref",
] as const;

export function withoutPromptLinkParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of PROMPT_LINK_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

export function buildNewThreadLink(input: {
  readonly prompt: string;
  readonly repository?: PromptLinkRepository | null;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly origin?: string;
}): string {
  const url = new URL("/new", input.origin ?? DEFAULT_HOSTED_APP_URL);
  url.searchParams.set("prompt", input.prompt);
  if (input.repository) {
    url.searchParams.set("repo", `${input.repository.owner}/${input.repository.name}`);
  }
  if (input.provider) url.searchParams.set("provider", input.provider);
  if (input.provider && input.model) url.searchParams.set("model", input.model);
  return url.toString();
}

const APP_SCHEME = /^t3code(?:-[a-z]+)?:$/;
const THREAD_PATH = /^\/([^/]+)\/([^/]+)\/?$/;

export function promptLinkAppPath(
  value: string,
  hostedAppUrl: string = DEFAULT_HOSTED_APP_URL,
): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (APP_SCHEME.test(url.protocol)) {
    if (url.host === "new" && (url.pathname === "" || url.pathname === "/")) {
      return `/new${url.search}`;
    }
    const thread = url.host === "threads" ? THREAD_PATH.exec(url.pathname) : null;
    return thread ? `/${thread[1]}/${thread[2]}${url.search}` : null;
  }
  if (!URL.canParse(hostedAppUrl) || url.origin !== new URL(hostedAppUrl).origin) return null;
  if (url.pathname === "/new") return `/new${url.search}`;
  const thread = url.searchParams.has("prompt") ? THREAD_PATH.exec(url.pathname) : null;
  return thread ? `/${thread[1]}/${thread[2]}${url.search}` : null;
}

export function promptLinkDeepLink(appPath: string, scheme = "t3code"): string {
  const url = new URL(appPath, "https://app.invalid");
  const host = url.pathname === "/new" ? "new" : `threads${url.pathname}`;
  return `${scheme}://${host}${url.search}`;
}
