import {
  APP_REFERENCE_DETAIL_NAME_MAX_CHARS,
  APP_REFERENCE_DETAIL_VALUE_MAX_CHARS,
  APP_REFERENCE_MAX_DETAILS,
  APP_REFERENCE_TITLE_MAX_CHARS,
  APP_REFERENCE_URL_MAX_CHARS,
} from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import {
  type LinkedPrompt,
  type NewThreadLink,
  parseNewThreadLink as parseNewThreadLinkWith,
  parseThreadLinkPrompt as parseThreadLinkPromptWith,
  PROMPT_LINK_MAX_PROMPT_LENGTH,
  type PromptLinkError,
  type PromptLinkResult,
} from "./promptLinks.ts";

function promptLinkErrorMessage(error: PromptLinkError, resolve: MFunctionType): string {
  switch (error) {
    case "prompt-too-long":
      return resolve(
        msg("This prompt is longer than {maxLength} characters, so T3 Code did not open it.", {
          maxLength: PROMPT_LINK_MAX_PROMPT_LENGTH.toLocaleString("en-US"),
        }),
      );
    case "prompt-only-hidden":
      return resolve(
        msg(
          "This prompt had only hidden characters, so it may be malicious. T3 Code did not open it.",
        ),
      );
    case "unreadable-pull-request":
      return resolve(msg("This link names a pull request T3 Code cannot read."));
    case "missing-prompt":
      return resolve(msg("This link has no prompt."));
    case "unreadable-repository":
      return resolve(msg("This link names a repository T3 Code cannot read."));
    case "reference-too-long":
      return resolve(msg("This link's app reference is too long, so T3 Code did not open it."));
    case "reference-not-json":
      return resolve(
        msg("This link's app reference is not valid JSON, so T3 Code did not open it."),
      );
    case "reference-not-object":
      return resolve(
        msg("This link's app reference is not a JSON object, so T3 Code did not open it."),
      );
    case "reference-no-title":
      return resolve(msg("This link's app reference has no title, so T3 Code did not open it."));
    case "reference-empty-title":
      return resolve(
        msg("This link's app reference has an empty title, so T3 Code did not open it."),
      );
    case "reference-title-too-long":
      return resolve(
        msg(
          "This link's app reference has a title longer than {max} characters, so T3 Code did not open it.",
          { max: String(APP_REFERENCE_TITLE_MAX_CHARS) },
        ),
      );
    case "reference-url-not-text":
      return resolve(
        msg("This link's app reference has a link that is not text, so T3 Code did not open it."),
      );
    case "reference-url-too-long":
      return resolve(
        msg(
          "This link's app reference has a link longer than {max} characters, so T3 Code did not open it.",
          { max: String(APP_REFERENCE_URL_MAX_CHARS) },
        ),
      );
    case "reference-url-unopenable":
      return resolve(
        msg(
          "This link's app reference has a link T3 Code cannot open, so T3 Code did not open it.",
        ),
      );
    case "reference-url-blocked":
      return resolve(
        msg(
          "This link's app reference has a kind of link T3 Code does not open, so T3 Code did not open it.",
        ),
      );
    case "reference-details-not-list":
      return resolve(
        msg(
          "This link's app reference has details that are not a list, so T3 Code did not open it.",
        ),
      );
    case "reference-too-many-details":
      return resolve(
        msg("This link's app reference has more than {max} details, so T3 Code did not open it.", {
          max: String(APP_REFERENCE_MAX_DETAILS),
        }),
      );
    case "reference-detail-not-pair":
      return resolve(
        msg(
          "This link's app reference has a detail that is not a [name, value] pair of text, so T3 Code did not open it.",
        ),
      );
    case "reference-detail-no-name":
      return resolve(
        msg("This link's app reference has a detail without a name, so T3 Code did not open it."),
      );
    case "reference-detail-name-too-long":
      return resolve(
        msg(
          "This link's app reference has a detail name longer than {max} characters, so T3 Code did not open it.",
          { max: String(APP_REFERENCE_DETAIL_NAME_MAX_CHARS) },
        ),
      );
    case "reference-detail-value-too-long":
      return resolve(
        msg(
          "This link's app reference has a detail value longer than {max} characters, so T3 Code did not open it.",
          { max: String(APP_REFERENCE_DETAIL_VALUE_MAX_CHARS) },
        ),
      );
  }
}

/** @public */
export function parseNewThreadLink(
  search: string,
  resolve: MFunctionType = mFallback,
): PromptLinkResult<NewThreadLink> {
  return parseNewThreadLinkWith(search, (error) => promptLinkErrorMessage(error, resolve));
}

/** @public */
export function parseThreadLinkPrompt(
  search: string,
  resolve: MFunctionType = mFallback,
): PromptLinkResult<LinkedPrompt | null> {
  return parseThreadLinkPromptWith(search, (error) => promptLinkErrorMessage(error, resolve));
}
