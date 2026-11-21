# mobile trust prompt links from apps the user chose

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
  The cache is published only after a write succeeds; Settings reads it through an atom that a
  write refreshes.
- `showPromptLinkNotice` takes the source. A trusted key skips the notice and runs the dismiss
  path (thread links: focus the composer). A hidden-characters warning, an unavailable model or
  pull request, and the clone notice always show. An unknown key with a `from` adds
  "Don't ask again for <from>", which trusts the key and proceeds like OK. The button is not
  offered under a hidden-characters warning, and the replace-draft question is unchanged.
- Thread links (`threadPromptLink.ts`) and new-task links (`newTaskPromptLink.ts`) both pass the
  source; both drop `from` and `key` from the route params with the rest of the link (mobile's
  param list is the shared `PROMPT_LINK_PARAMS`). Web's `ThreadLinkPrompt` strips a link that
  carries only `from`/`key` too.
- Settings > Trusted link sources (next to Labs; also found by searching "prompt links") lists
  entries (label · added date) with Remove. User docs describe the `from`/`key` parameters and
  how to stop trusting an app.
- All new copy is translated (`m(msg())` / `useGT`) in every mobile locale.

## Validation Coverage

- `packages/shared/src/promptLinks.test.ts`: from/key kept out of the prompt and stripped,
  malformed keys ignored, label cleaned and truncated, the trailing space kept.
- `apps/mobile/src/features/prompt-links/prompt-link-actions.test.ts`: unknown key offers the
  button and stores only the hash, a trusted key skips the notice and focuses, no key or no
  `from` offers nothing, hidden characters still warn for a trusted key, removal brings the
  notice back.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `6a3f26f3be3` (fork note
`commits/mobile trusted prompt link sources.md`). Upstream replaced the fork's
`usePromptLinkResolver` / `useThreadPromptLink` hooks with navigation-state resolvers
(`newTaskPromptLink.ts`, `threadPromptLink.ts`), moved settings rows to
`settings-page-targets.ts` with a search index, and translated all prompt-link copy; the source
plumbing, settings page, and notice buttons follow those shapes. The fork's
`useSyncExternalStore` store became an atom because lint rejects effect-driven loads.
