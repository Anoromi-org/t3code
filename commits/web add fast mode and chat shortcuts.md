# web add fast mode and chat shortcuts

## Goal

Add `/fast` and chat-scoped shortcuts: `Mod+Shift+S` focuses the composer and `Mod+Shift+C`
stops the running turn.

## Included Changes

- `/fast` is a built-in slash command shown only when the selected model has a live fast control
  and one model is selected. It flips either the boolean `fastMode` option or a `serviceTier`
  select with Fast and Standard tiers (`composerFastMode.ts`), resolving selections through
  upstream's `withImplicitFastModeDefault` so a provider that defaults to Fast reads as off until
  chosen, like the traits picker. The change is written the way upstream's
  `stepReasoningEffort` writes options (sticky per instance and model). Typing `/fast` and
  pressing Enter selects the highlighted menu item.
- `chat.composer.focus` is a new command (`mod+shift+s`) and upstream's `thread.stop` gets
  `mod+shift+c` as its default. Both are entries in upstream's ChatView command map and let the
  keys through when there is no composer or nothing running. Settling moves to
  `mod+alt+shift+s` and copying a thread or pull request reference to `mod+alt+shift+c`.

## Dropped

- The fork's separate capture-phase `useChatScopedShortcuts` listener and per-thread interrupt
  lock. Upstream's `useChatShortcuts` command map now owns chat shortcuts and its stop handler.
- The server migration that moved old generated settle and copy-reference rules. The
  maintainer's keybindings file already has the fork bindings.

## Validation Coverage

`composerFastMode.test.ts` (service-tier and boolean controls, implicit Normal default, explicit
Fast, unrelated selections, non-fast descriptors) and the default-shortcut cases in
`keybindings.test.ts`, `KeybindingsSettings.logic.test.ts`, and `settingsSearch.test.ts`.

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `b65731a7eb` (itself from `0198e373ba`).
