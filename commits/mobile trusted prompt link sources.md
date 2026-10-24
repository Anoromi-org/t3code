# mobile trusted prompt link sources

## Goal

An app that opens T3 Code with prompt links many times a day (the learning app's Ask button)
can be trusted once, so its links fill the composer and focus it without the "Prompt from a
link" notice each time. Links may carry `from=<app name>&key=<secret>`; the app keeps the
secret, the phone keeps only its SHA-256.

## Included Changes

- `packages/shared/src/promptLinks.ts`: `parsePromptLinkSource` reads `from` (cleaned of hidden
  characters, whitespace collapsed, at most 32 characters) and `key` (base64url, 16 to 256
  characters; anything else means no source). Neither is ever part of the prompt, and
  `withoutPromptLinkParams` strips both, so web removes them from the address bar too.
- `sanitizeLinkedPrompt` keeps one trailing space when the prompt ended with one. Citations
  like `[lesson 3 · …] ` rely on it so the caret lands after the space. Leading whitespace and
  trailing newlines are still trimmed.
- Mobile `trusted-link-sources.ts`: entries `{ label, keyHash, addedAt }` in expo-secure-store.
  The cache is published only after a write succeeds.
- `showPromptLinkNotice` takes the source. A trusted key skips the notice and runs the dismiss
  path (thread links: focus the composer). A hidden-characters warning, an unavailable model or
  pull request, and the clone notice always show. An unknown key with a `from` adds
  "Don't ask again for <from>", which trusts the key and proceeds like OK. The button is not
  offered under a hidden-characters warning, and the replace-draft question is unchanged.
- Thread links and new-thread links (`usePromptLinkResolver`) both pass the source; their route
  params clear `from` and `key` with the rest of the link.
- Settings > App > Trusted link sources lists entries (label · added date) with Remove.

## Validation Coverage

- `packages/shared/src/promptLinks.test.ts`: from/key kept out of the prompt and stripped,
  malformed keys ignored, label cleaned and truncated, the trailing space kept.
- `apps/mobile/src/features/prompt-links/prompt-link-actions.test.ts`: unknown key offers the
  button and stores only the hash, a trusted key skips the notice and focuses, no key or no
  `from` offers nothing, hidden characters still warn for a trusted key, removal brings the
  notice back.
