# web add project actions panel

## Goal

Add a project-scoped `Mod+P` panel for the current thread's project actions, source-control
steps, and supported Open In targets, reachable entirely from the keyboard.

## Included Changes

- `ProjectActionsPanelControl` (mounted by ChatView for threads with a project) owns
  `projectActions.toggle` (`mod+p`). The panel is a modal command surface
  (`data-command-surface="project-actions"`): it does not open over another surface, its own
  toggle closes it, and every other resolved shortcut is swallowed while it is open. Unbound keys
  such as typing, arrows, and Escape reach its search field.
- The file picker moves to `mod+shift+p` and thread pinning to `mod+alt+shift+p`.
- Git steps route to upstream's `GitActionsControl`, which now lives in the thread details panel:
  a one-shot `GitActionRequest` opens that panel and the control runs the request once, so
  dialogs, toasts, pull, publish, and init reuse the existing flows. The pull flow is shared as
  `runPullAction` with upstream's inline-success behavior.
- Open In reuses upstream `resolveOpenInOptions`, the remote-open modes, `ScriptIcon`, and
  `PullRequestGlyph`. The panel body only mounts while open, so status queries and row building
  run only then. Focus returns to whatever had it when the panel opened, unless an action ran.

## Dropped

- The startup migration that renamed `commandBar.toggle` and moved old generated `mod+p` /
  `mod+shift+p` rules. It only served old fork keybinding files; the maintainer's file already
  has the final bindings.
- The `replaceAllForCommand` / remove-all keybinding API. Upstream's upsert now replaces the
  previous binding when an action's shortcut changes.
- The "open existing pull request" git step, which upstream removed from the git action menu.

## Validation Coverage

`ProjectActionsPanel.logic.test.ts` (descriptors across repository states, loading and error
rows, search and group order, modal shortcut disposition), the updated default-shortcut cases in
`keybindings.test.ts`, and `ProjectActionsPanel.browser.test.tsx` (focus, search and single
execution, git request routing, editor launch, Escape focus restoration, surface exclusion,
blocked global shortcuts).

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `6e82711236` (itself from `ff68ecc6e9`).
