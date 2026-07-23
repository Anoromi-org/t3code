# Web add project actions panel

Add a project-scoped Mod+P launcher for configured scripts, current source-control workflows, and supported Open In targets. Coordinate it with the upstream command palette, Mod+Shift+P file picker, content search, and navigation menu; preserve terminal-focus exclusions; migrate legacy `commandBar.toggle` keybindings to the private `projectActions.toggle` command; and move only the exact former upstream Mod+P file-picker default while preserving custom bindings.

## Reimplementation Sources

This intent reimplements source commit `c678a976e6` against the pinned upstream command palette, sidebar, source-control presentation, editor discovery, and chat header surfaces. It delegates scripts, Git mutations, dialogs, pull-request links, repository publishing, and editor launches to upstream implementations rather than duplicating those workflows.

## Validation Coverage

Unit tests cover configured script and editor descriptors, repository initialization and its running state, changes, ahead/behind/diverged/default-ref states, missing remotes, detached refs, open change requests, loading and error rows, search aliases, modal shortcut disposition, keybinding parsing and labels, legacy command-bar migration, and the frozen pre-navigation generated-keybinding snapshot. Chromium coverage verifies Mod+P focus, search and single execution, routing into the existing Git action flow, editor launching, Escape focus restoration, command-surface mutual exclusion, and blocking unrelated global shortcuts behind the panel.

## September upstream modernization

Keep upstream compaction, settlement, pinning, terminal close confirmation, project icons, and editor discovery. The panel uses remote editor links on the viewing machine and hides editor actions when remote opening is unavailable. Preserve the newer platform-specific editor labels and route Git actions through the existing controls. Focused project-action and keybinding checks pass (129 tests); browser coverage remains for integrated verification.
