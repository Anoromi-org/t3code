# mobile focus composer after a prompt link

## Goal

When a thread opens through a prompt deep link
(`t3code://threads/<environmentId>/<threadId>?prompt=<text>`, also the dev and preview schemes),
the composer takes focus so the keyboard opens with the caret after the prefilled text. Other
apps (the learning app) open a thread with a citation prefilled and the user only types the
question.

## Included Changes

- `applyLinkedPromptToThreadDraft` requests composer focus when its dialog closes: "OK" on the
  link notice (including the hidden characters warning), and both "Keep mine" and "Replace" on
  the replace-draft question. The keyboard never opens under a dialog.
- Filling the draft also records the caret at the end of the linked text
  (`rememberComposerDraftSelection`). Without it, a composer already showing that thread clamps
  its old caret (0 for an empty draft) and the caret lands before the citation.
- `linked-composer-focus.ts` keeps one pending focus request per draft key until the composer
  for that thread takes it, so a notice dismissed before the thread finishes loading (cold
  start) still focuses once the composer mounts. `ThreadDetailScreen` takes requests for its
  thread via `useLinkedComposerFocus`.
- Only the prompt-link path requests focus; ordinary thread opens are unchanged. The
  pull-request link path that reuses an existing thread goes through the same function and
  gets the same focus.

## Validation Coverage

`apps/mobile/src/features/prompt-links/prompt-link-actions.test.ts`: fill puts the caret at
the end and focuses only after the notice closes, both replace answers focus, and a pending
request survives until its own composer takes it, once.
