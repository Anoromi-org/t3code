# desktop add Ctrl+Tab thread switcher

## Goal

A desktop Ctrl+Tab recent-thread switcher: Ctrl+Tab and Ctrl+Shift+Tab cycle recently visited
threads and drafts, releasing Control or leaving the window opens the highlighted one, and Escape
cancels. The gesture also works while a browser preview has focus.

## Included Changes

- Electron main owns the gesture. `DesktopWindow` runs the switcher input controller
  (`DesktopThreadSwitcher.ts`) in its `before-input-event` handler and commits on window blur,
  sending `advance-forward`, `advance-backward`, `commit`, or `cancel` over
  `desktop:thread-switcher-action`. The preload exposes it as `onThreadSwitcherAction`.
- A focused preview gets keys before the main window, so the preview manager replays Ctrl+Tab, and
  the Control release or Escape that ends a forwarded gesture, into the main window with
  `sendInputEvent` before upstream's shortcut forwarding. The page never sees those keys, and the
  gesture resets when the preview loses focus.
- The renderer keeps an in-memory MRU list (`recentThreadStore`). `RecentThreadSwitcherControl`
  (desktop only, in `AppSidebarLayout`) records visits from upstream's route target hook. A
  gesture freezes the list, which is reconciled at gesture start and on commit so archived,
  deleted, or projectless threads, cleared drafts, and promoted drafts (which resolve to their
  thread) never open. The switcher does not open over another command surface and is tagged
  `data-command-surface="thread-switcher"`.

## Dropped

The commit's "stabilize tsgo prepare" half: upstream's `prepare` script is already
`effect-tsgo patch && vp config --no-agent`.

## Validation Coverage

`DesktopThreadSwitcher.test.ts`, the Ctrl+Tab cases in `DesktopWindow.test.ts` and
`Manager.test.ts`, the IPC contract test, `recentThreadStore.test.ts`,
`RecentThreadSwitcher.logic.test.ts`, `RecentThreadSwitcher.browser.test.tsx`, and
`RecentThreadSwitcherControl.browser.test.tsx` (frozen cycle with one navigation, cancel, a thread
removed mid-gesture, no stacking over another surface).

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `9b262967a5` ("desktop add Ctrl+Tab thread
switcher and stabilize tsgo prepare", itself from `e4f4a0b31b`).
