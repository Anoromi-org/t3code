# mobile show prompt link app references as a context chip

## Goal

Apps that open T3 Code with prompt links (the learning app's Ask button) wrote a plain-text
citation such as `[lesson 3 · learn-lr-game · part rush v1 · round 2 · stack: E + n] ` into the
prompt. A link can now carry that as structured data in `ref`, and mobile shows it as one
context chip with a human title in front of the prompt, like a file or thread chip.

## Included Changes

- `packages/contracts/src/composerContext.ts`: new known kind `app-reference`,
  `{ label, app, url, details: [{ name, value }] }`, with the link limits (title 120, url 2048,
  12 details, name 40, value 200).
- `packages/shared/src/promptLinks.ts`: `ref` is URL-encoded JSON
  `{ title, url?, details?: [[name, value], ...] }`, read on thread and new-thread links and
  returned as `LinkedPrompt.reference`. Title, names and values go through the prompt's
  hidden-character sanitizer, whitespace collapsed, and their hidden characters add to the
  link's count, so the unskippable warning fires. Bad JSON, shape, limits, a url without a
  scheme, with blanks or hidden characters, or with `javascript:`/`data:`/`file:`/`vbscript:`/
  `blob:` fail the link with a reason. Reasons are `PromptLinkError` codes, with English copy in
  `promptLinks.ts` and translated copy in `promptLinksCopy.ts`; a blocked scheme is reported
  without naming it. A link with only `ref` is valid. `ref` joins `PROMPT_LINK_PARAMS`;
  `parsePromptLinkFrom` reads `from` without needing `key`.
- `packages/shared/src/composerContextReferences.ts`: provider payload lines `app:`, `title:`,
  `url:`, one `<name>: <value>` per detail (each forced to one line), then the
  context-not-instructions sentence. `composerContextDigest` exposes the existing FNV hash.
  Upstream has no client-side legacy send path any more (the server projects context for every
  provider), so there is no `<app_reference>` block; the envelope's existing escaping keeps the
  details from closing it.
- Mobile: `linkedPromptDraft` builds `[title](t3-context://v1/app-reference/<id>) <prompt>`
  with id `app-reference_<digest of app, title, url, details>`, so one link opened twice is
  the same draft (`linkedThreadDraftAction` compares the full text). `fillLinkedDraft` adds the
  record to the draft context before the text and keeps the caret at the end, for thread and
  new-thread links (`threadPromptLink.ts`, `newTaskPromptLink.ts`). Clone links still pass only
  the prompt text, and a reference-only link does not claim its prompt opens after the clone.
  Route params clear `ref`.
- Mobile presentation: accent `#699630` (web `oklch(0.62 0.14 130)`) and lucide `link-2`.
  Upstream's native chips on iOS and Android draw generated PNG icons
  (`scripts/sync-context-chip-icons.mjs`), so `link-2` joined that list instead of a hand-drawn
  Kotlin path in `T3ContextChip.kt`. The context sheet shows From, the details as a name/value
  list, and "Open in <app>" (`Linking.openURL`) when there is a url. All copy is translated.
- Web: renders `app-reference` on sent messages as `AppReferenceContextChip` (lucide `Link2`,
  tooltip of the app and details) through `UserMessageContextChips`, with the accent in
  `lib/contextChipAccents.ts`. Web links ignore `ref` (a reference-only link adds nothing) and
  strip it from the address bar.

## Validation Coverage

- `packages/shared/src/promptLinks.test.ts`: valid ref, ref without prompt on both link kinds,
  hidden characters counted, malformed JSON and shapes, limits, blocked and schemeless urls.
- `packages/shared/src/composerContextReferences.test.ts`: marker and payload, one-line fields,
  no app/url.
- `packages/shared/src/composerContextReferences.test.ts` ("carries an app reference's details
  in the provider envelope, unclosable") replaces the fork's legacy-send case.
- `packages/contracts/src/composerContext.test.ts`: round trip and limits.
- `apps/mobile/src/features/prompt-links/prompt-link-model.test.ts`,
  `prompt-link-actions.test.ts`: chip text and identity, record merged into the draft, caret,
  focus, reopen keeps the draft, replace keeps the chip first.
- `apps/mobile/src/lib/composerChipPresentation.test.ts`: the kind's accent and symbol.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `de99ae51ef4` (fork note
`commits/mobile app reference chips from prompt links.md`). Upstream removed
`composerContextLegacySend.ts`, moved native chip glyphs to generated PNGs, translated prompt-link
errors through `promptLinksCopy.ts`, and replaced the fork's link resolver hooks with
navigation-state resolvers; the reference parsing, chip, payload, and draft behavior follow
those shapes.
