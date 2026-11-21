import {
  APP_REFERENCE_DETAIL_NAME_MAX_CHARS,
  APP_REFERENCE_DETAIL_VALUE_MAX_CHARS,
  APP_REFERENCE_MAX_DETAILS,
  APP_REFERENCE_TITLE_MAX_CHARS,
  APP_REFERENCE_URL_MAX_CHARS,
} from "@t3tools/contracts";

import { DEFAULT_HOSTED_APP_URL } from "./connectAuth.ts";
import { parseUrl } from "./url.ts";

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

// Hidden characters let models read instructions invisible to the person reviewing the prompt.
const HIDDEN_CHARACTERS =
  // oxlint-disable-next-line no-misleading-character-class -- these are the characters it removes.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF0-\uFFFB\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E0FFF}]/gu;
// Numeric emoji ranges because Hermes lacks Unicode property escapes.
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

export type PromptLinkError =
  | "prompt-too-long"
  | "prompt-only-hidden"
  | "unreadable-pull-request"
  | "missing-prompt"
  | "unreadable-repository"
  | PromptLinkReferenceError;

export type PromptLinkReferenceError =
  | "reference-too-long"
  | "reference-not-json"
  | "reference-not-object"
  | "reference-no-title"
  | "reference-empty-title"
  | "reference-title-too-long"
  | "reference-url-not-text"
  | "reference-url-too-long"
  | "reference-url-unopenable"
  | "reference-url-blocked"
  | "reference-details-not-list"
  | "reference-too-many-details"
  | "reference-detail-not-pair"
  | "reference-detail-no-name"
  | "reference-detail-name-too-long"
  | "reference-detail-value-too-long";

const referenceProblem = (problem: string) =>
  `This link's app reference ${problem}, so T3 Code did not open it.`;

function englishPromptLinkError(error: PromptLinkError): string {
  switch (error) {
    case "prompt-too-long":
      return `This prompt is longer than ${PROMPT_LINK_MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters, so T3 Code did not open it.`;
    case "prompt-only-hidden":
      return "This prompt had only hidden characters, so it may be malicious. T3 Code did not open it.";
    case "unreadable-pull-request":
      return "This link names a pull request T3 Code cannot read.";
    case "missing-prompt":
      return "This link has no prompt.";
    case "unreadable-repository":
      return "This link names a repository T3 Code cannot read.";
    case "reference-too-long":
      return referenceProblem("is too long");
    case "reference-not-json":
      return referenceProblem("is not valid JSON");
    case "reference-not-object":
      return referenceProblem("is not a JSON object");
    case "reference-no-title":
      return referenceProblem("has no title");
    case "reference-empty-title":
      return referenceProblem("has an empty title");
    case "reference-title-too-long":
      return referenceProblem(
        `has a title longer than ${APP_REFERENCE_TITLE_MAX_CHARS} characters`,
      );
    case "reference-url-not-text":
      return referenceProblem("has a link that is not text");
    case "reference-url-too-long":
      return referenceProblem(`has a link longer than ${APP_REFERENCE_URL_MAX_CHARS} characters`);
    case "reference-url-unopenable":
      return referenceProblem("has a link T3 Code cannot open");
    case "reference-url-blocked":
      return referenceProblem("has a kind of link T3 Code does not open");
    case "reference-details-not-list":
      return referenceProblem("has details that are not a list");
    case "reference-too-many-details":
      return referenceProblem(`has more than ${APP_REFERENCE_MAX_DETAILS} details`);
    case "reference-detail-not-pair":
      return referenceProblem("has a detail that is not a [name, value] pair of text");
    case "reference-detail-no-name":
      return referenceProblem("has a detail without a name");
    case "reference-detail-name-too-long":
      return referenceProblem(
        `has a detail name longer than ${APP_REFERENCE_DETAIL_NAME_MAX_CHARS} characters`,
      );
    case "reference-detail-value-too-long":
      return referenceProblem(
        `has a detail value longer than ${APP_REFERENCE_DETAIL_VALUE_MAX_CHARS} characters`,
      );
  }
}

function readPromptText(
  params: URLSearchParams,
  describe: (error: PromptLinkError) => string,
): PromptLinkResult<LinkedPrompt | null> {
  const raw = params.get("prompt");
  if (raw === null) return { ok: true, value: null };
  if (raw.length > PROMPT_LINK_MAX_PROMPT_LENGTH) {
    return { ok: false, error: describe("prompt-too-long") };
  }
  const prompt = sanitizeLinkedPrompt(raw);
  if (prompt.text.length === 0 && prompt.hiddenCharacters > 0) {
    return { ok: false, error: describe("prompt-only-hidden") };
  }
  return { ok: true, value: prompt.text.length > 0 ? prompt : null };
}

const PROMPT_LINK_MAX_REFERENCE_LENGTH = 16_000;
// A scheme and something after it. `javascript:` and friends run or embed content instead of
// opening the app that sent the link.
const REFERENCE_URL = /^([a-z][a-z0-9+.-]*):\S+$/i;
const BLOCKED_REFERENCE_SCHEMES = new Set(["javascript", "data", "file", "vbscript", "blob"]);

type ReadReferenceResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly reference: PromptLinkReference;
        readonly hiddenCharacters: number;
      } | null;
    }
  | { readonly ok: false; readonly error: PromptLinkReferenceError };

function readReferenceUrl(input: unknown): PromptLinkReferenceError | { url: string | null } {
  if (input === undefined || input === null) return { url: null };
  if (typeof input !== "string") return "reference-url-not-text";
  const url = input.trim();
  if (url.length === 0) return { url: null };
  if (url.length > APP_REFERENCE_URL_MAX_CHARS) return "reference-url-too-long";
  const scheme = REFERENCE_URL.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined || sanitizeLinkedPrompt(url).text !== url) {
    return "reference-url-unopenable";
  }
  return BLOCKED_REFERENCE_SCHEMES.has(scheme) ? "reference-url-blocked" : { url };
}

function readReference(params: URLSearchParams): ReadReferenceResult {
  const fail = (error: PromptLinkReferenceError) => ({ ok: false, error }) as const;
  const raw = params.get("ref");
  if (raw === null) return { ok: true, value: null };
  if (raw.length > PROMPT_LINK_MAX_REFERENCE_LENGTH) return fail("reference-too-long");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail("reference-not-json");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("reference-not-object");
  }
  const input = value as Record<string, unknown>;
  let hiddenCharacters = 0;
  const visible = (text: string) => {
    const sanitized = sanitizeLinkedPrompt(text);
    hiddenCharacters += sanitized.hiddenCharacters;
    return sanitized.text.replace(/\s+/g, " ").trim();
  };

  if (typeof input.title !== "string") return fail("reference-no-title");
  const title = visible(input.title);
  if (title.length === 0) return fail("reference-empty-title");
  if (title.length > APP_REFERENCE_TITLE_MAX_CHARS) return fail("reference-title-too-long");

  const url = readReferenceUrl(input.url);
  if (typeof url === "string") return fail(url);

  const details: Array<{ readonly name: string; readonly value: string }> = [];
  if (input.details !== undefined) {
    if (!Array.isArray(input.details)) return fail("reference-details-not-list");
    if (input.details.length > APP_REFERENCE_MAX_DETAILS) return fail("reference-too-many-details");
    for (const detail of input.details as ReadonlyArray<unknown>) {
      if (
        !Array.isArray(detail) ||
        detail.length !== 2 ||
        typeof detail[0] !== "string" ||
        typeof detail[1] !== "string"
      ) {
        return fail("reference-detail-not-pair");
      }
      const name = visible(detail[0]);
      const text = visible(detail[1]);
      if (name.length === 0) return fail("reference-detail-no-name");
      if (name.length > APP_REFERENCE_DETAIL_NAME_MAX_CHARS) {
        return fail("reference-detail-name-too-long");
      }
      if (text.length > APP_REFERENCE_DETAIL_VALUE_MAX_CHARS) {
        return fail("reference-detail-value-too-long");
      }
      details.push({ name, value: text });
    }
  }
  return { ok: true, value: { reference: { title, url: url.url, details }, hiddenCharacters } };
}

function readPrompt(
  params: URLSearchParams,
  describe: (error: PromptLinkError) => string,
): PromptLinkResult<LinkedPrompt | null> {
  const prompt = readPromptText(params, describe);
  if (!prompt.ok) return prompt;
  const reference = readReference(params);
  if (!reference.ok) return { ok: false, error: describe(reference.error) };
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

export function parseNewThreadLink(
  search: string,
  describe: (error: PromptLinkError) => string = englishPromptLinkError,
): PromptLinkResult<NewThreadLink> {
  const params = new URLSearchParams(search);
  const prompt = readPrompt(params, describe);
  if (!prompt.ok) return prompt;
  const pr = params.get("pr");
  if (pr !== null) {
    const pullRequest = parsePromptLinkPullRequest(pr);
    if (pullRequest === null) {
      return { ok: false, error: describe("unreadable-pull-request") };
    }
    return { ok: true, value: { kind: "pull-request", pullRequest, prompt: prompt.value } };
  }
  if (prompt.value === null) return { ok: false, error: describe("missing-prompt") };
  const repo = params.get("repo");
  const repository = repo === null ? null : parsePromptLinkRepository(repo);
  if (repo !== null && repository === null) {
    return { ok: false, error: describe("unreadable-repository") };
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

export function parseThreadLinkPrompt(
  search: string,
  describe: (error: PromptLinkError) => string = englishPromptLinkError,
): PromptLinkResult<LinkedPrompt | null> {
  return readPrompt(new URLSearchParams(search), describe);
}

export interface PromptLinkSource {
  /** Display only; anyone can write any `from`. */
  readonly label: string | null;
  /** Secret the linking app keeps. Store a hash, never this. */
  readonly key: string;
}

const PROMPT_LINK_SOURCE_LABEL_MAX = 32;
const PROMPT_LINK_SOURCE_KEY = /^[A-Za-z0-9_-]{16,256}$/;

// `from` and `key` identify the app that built a link so a client can trust it. They are never
// part of the prompt.
export function parsePromptLinkSource(search: string): PromptLinkSource | null {
  const key = new URLSearchParams(search).get("key");
  if (key === null || !PROMPT_LINK_SOURCE_KEY.test(key)) return null;
  return { label: parsePromptLinkFrom(search), key };
}

/** The link's `from`, cleaned for display. Anyone can write any `from`. */
export function parsePromptLinkFrom(search: string): string | null {
  const from = Array.from(
    sanitizeLinkedPrompt(new URLSearchParams(search).get("from") ?? "")
      .text.replace(/\s+/g, " ")
      .trim(),
  );
  if (from.length === 0) return null;
  return from.length > PROMPT_LINK_SOURCE_LABEL_MAX
    ? `${from
        .slice(0, PROMPT_LINK_SOURCE_LABEL_MAX - 1)
        .join("")
        .trimEnd()}…`
    : from.join("");
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
  const url = parseUrl(value);
  if (!url) return null;
  if (APP_SCHEME.test(url.protocol)) {
    if (url.host === "new" && (url.pathname === "" || url.pathname === "/")) {
      return `/new${url.search}`;
    }
    const thread = url.host === "threads" ? THREAD_PATH.exec(url.pathname) : null;
    return thread ? `/${thread[1]}/${thread[2]}${url.search}` : null;
  }
  if (url.origin !== parseUrl(hostedAppUrl)?.origin) return null;
  if (url.pathname === "/new") return `/new${url.search}`;
  // The web app's own thread route is a link only with a prompt, so reloading a tab never asks.
  const thread = url.pathname.startsWith("/threads/")
    ? THREAD_PATH.exec(url.pathname.slice("/threads".length))
    : url.searchParams.has("prompt")
      ? THREAD_PATH.exec(url.pathname)
      : null;
  return thread ? `/${thread[1]}/${thread[2]}${url.search}` : null;
}

export function promptLinkDeepLink(appPath: string, scheme = "t3code"): string {
  const url = new URL(appPath, "https://app.invalid");
  const host = url.pathname === "/new" ? "new" : `threads${url.pathname}`;
  return `${scheme}://${host}${url.search}`;
}
