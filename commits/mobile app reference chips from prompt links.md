# mobile app reference chips from prompt links

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
  `blob:` fail the link with a reason. A link with only `ref` is valid. `ref` joins
  `PROMPT_LINK_PARAMS`; `parsePromptLinkFrom` reads `from` without needing `key`.
- `packages/shared/src/composerContextReferences.ts`: provider payload lines `app:`, `title:`,
  `url:`, one `<name>: <value>` per detail (each forced to one line), then the
  context-not-instructions sentence. `composerContextDigest` exposes the existing FNV hash.
  Servers without inline message context get the same lines in an `<app_reference>` block from
  `serializeLegacyContextMessage`.
- Mobile: `linkedPromptDraft` builds `[title](t3-context://v1/app-reference/<id>) <prompt>`
  with id `app-reference_<digest of app, title, url, details>`, so one link opened twice is
  the same draft (`linkedThreadDraftAction` compares the full text). `fillLinkedDraft` adds the
  record to the draft context before the text and keeps the caret at the end, for thread and
  new-thread links. Clone links still pass only the prompt text. Route params clear `ref`.
- Mobile presentation: accent `#699630` (web `oklch(0.62 0.14 130)`), SF Symbol `link`, a
  drawn `link-2` glyph on Android. The context sheet shows From, the details as a name/value
  list, and "Open in <app>" (`Linking.openURL`) when there is a url.
- Web: renders `app-reference` on sent messages as a chip with a tooltip of the app and
  details. Web links ignore `ref` (a reference-only link adds nothing) and strip it from the
  address bar.

## Validation Coverage

- `packages/shared/src/promptLinks.test.ts`: valid ref, ref without prompt on both link kinds,
  hidden characters counted, malformed JSON and shapes, limits, blocked and schemeless urls.
- `packages/shared/src/composerContextReferences.test.ts`: marker and payload, one-line fields,
  no app/url.
- `packages/shared/src/composerContextLegacySend.test.ts`: the legacy block, unclosable.
- `packages/contracts/src/composerContext.test.ts`: round trip and limits.
- `apps/mobile/src/features/prompt-links/prompt-link-model.test.ts`,
  `prompt-link-actions.test.ts`: chip text and identity, record merged into the draft, caret,
  focus, reopen keeps the draft, replace keeps the chip first.
- `apps/mobile/src/lib/composerChipPresentation.test.ts`: the kind's accent and symbol.
