# Desktop add Ctrl+Tab thread switcher and stabilize tsgo prepare

Add a desktop Ctrl+Tab recent-thread switcher. Ctrl+Tab and Ctrl+Shift+Tab cycle through recently
visited threads and drafts, releasing Control or leaving the window opens the highlighted one, and
Escape cancels. The gesture also works while a browser preview has focus.

## Reimplementation Sources

This reimplements fork commit `e4f4a0b31b` on upstream `e4eb9977f0`.

- Electron main owns the gesture. `DesktopWindow` runs the switcher input controller in its
  `before-input-event` handler right after upstream's quit shortcut handler and commits on window
  blur. It sends `advance-forward`, `advance-backward`, `commit` or `cancel` to the renderer over
  `desktop:thread-switcher-action`; the preload bridge exposes it as the optional
  `onThreadSwitcherAction`.
- A focused preview webview gets keys before the main window does. The preview manager forwards
  Ctrl+Tab, and the Control release or Escape that ends a forwarded gesture, to the main window
  with `sendInputEvent`. This runs before upstream's menu-shortcut sync and returns early, so the
  page never sees those keys. The gesture flag resets when the preview loses focus. Sign-in popups
  are separate windows and do not forward: the main window is not focused while one is.
- The renderer keeps an in-memory MRU list (`recentThreadStore`). Visits are recorded from the
  thread and draft routes. A gesture freezes the list, and it is reconciled at gesture start and on
  commit so archived, deleted or projectless threads, cleared drafts and promoted drafts (which
  resolve to their thread) never open. The switcher does not open over another command surface and
  is tagged `data-command-surface="thread-switcher"`, so the other global shortcuts stay out while
  it is open. It is mounted next to the navigation shortcuts in Electron only.
  The highlighted entry is resolved too, both for the drawn highlight and when the cycle is
  reconciled, so a draft promoted mid-gesture keeps its position as its thread and traversal
  continues from there (the fork highlighted the first row and restarted the cycle).
- `docs/user/keybindings.md` describes the gesture.
- The switcher reuses the navigation menu's list, without a search field, and only layout classes
  on `ui/command` parts.
- The navigation menu (Ctrl+E) now ignores Enter while an IME composition is active, like the
  project actions panel. The switcher has no text input, so it needs no guard.
- tsgo prepare: upstream's `effect-tsgo patch` (`@effect/tsgo` 0.41) is now idempotent on its own.
  It keeps one `<binary>.original` backup, skips a binary whose hash already matches the
  replacement, and quarantines and removes the previous patch when it updates. Running it twice in
  a row reports "already patched" and leaves no numbered backups. The fork wrapper
  (`scripts/patch-effect-tsgo.ts`) and its test are dropped, and `prepare` stays upstream's
  `effect-tsgo patch && vp config --no-agent`. What is lost is the wrapper's handling of two
  installs patching at the same moment; the loser can back up the already-patched binary. Installs
  in one worktree do not overlap in practice.

## Validation Coverage

Desktop tests cover the input controller (forward, backward, commit, cancel, blur, ignored input,
preview forwarding rules), the main window routing the gesture to the renderer, and the preview
manager forwarding a complete gesture, resetting on blur, ignoring popups and removing its
listeners. A contracts test checks the action schema. Web tests cover MRU ordering, frozen
traversal, single commit, cancel, pruning, a promoted highlighted draft keeping its position, draft canonicalization and environment-scoped identity.
Chromium tests cover the switcher list and highlight, click and Escape, cycling and committing
once, a thread removed mid-gesture, a draft promoted mid-gesture, cancel, not stacking over the
navigation menu, and IME Enter in the navigation menu.
