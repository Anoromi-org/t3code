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
  `data-command-surface="thread-switcher"`. Its copy is translated in every web locale, and its
  browser tests use upstream's disposable `render`.

## Dropped

The commit's "stabilize tsgo prepare" half: upstream's `prepare` script is already
`effect-tsgo patch && vp config --no-agent`.

## Validation Coverage

`DesktopThreadSwitcher.test.ts`, the Ctrl+Tab cases in `DesktopWindow.test.ts` and
`Manager.test.ts`, the IPC contract test (now a fork-only `packages/contracts/src/ipc.test.ts`,
since upstream deleted that file), `recentThreadStore.test.ts`,
`RecentThreadSwitcher.logic.test.ts`, `RecentThreadSwitcher.browser.test.tsx`, and
`RecentThreadSwitcherControl.browser.test.tsx` (frozen cycle with one navigation, cancel, a thread
removed mid-gesture, no stacking over another surface).

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `2698b81b7d` (previously onto `13aa882c22`
from `9b262967a5`, itself from `e4f4a0b31b`).
