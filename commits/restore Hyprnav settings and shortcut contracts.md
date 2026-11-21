# Restore Hyprnav settings and shortcut contracts

## Goal

Carry project Hyprnav overrides through upstream's v2 project model, restore client-side Hyprnav
defaults and grouped-project state, and add a Mod+E thread/project navigation menu while Mod+K
stays the command palette.

## Included Changes

- `hyprnav` (a `ProjectHyprnavOverride`, `null` = inherit the client defaults) is part of the
  v2 project contracts: `Project`, `OrchestrationProjectShell`, the `project.created` and
  `project.meta-updated` application payloads, and `ProjectUpdatePayload`. It flows through
  `ProjectCommands`, `ProjectMutation`, `ProjectService`, and client-runtime `updateProject`.
- `ProjectStore` reads and writes `projection_projects.hyprnav_json`. New projects write `null`.
  A value that no longer decodes falls back to inheriting instead of hiding its project. A
  `project.created` without an override for an existing row (upstream's 055 re-baseline) keeps the
  stored override.
- Client settings gain `defaultProjectHyprnavSettings` and
  `groupedProjectHyprnavStateByLogicalProjectKey` (`same` shares one override across a grouped
  project's checkouts, `separate` keeps one per checkout).
- `navigation.commandMenu` defaults to `mod+e`. `NavigationCommandMenuControl` registers the shortcut
  as a capture scope in upstream's shortcut dispatcher,
  ranks recent threads and then threads and projects as you type, and opens a project's existing
  draft or starts a new thread. The menu body only mounts while open, so closing resets it.
- Open command surfaces carry `data-command-surface`. Every upstream `isCommandPaletteOpen()` guard
  becomes `isAnyCommandSurfaceOpen()` (`commandSurface.ts`) so modal keyboard input cannot trigger
  background shortcuts or stack another surface. The palette keeps `data-command-palette` too,
  because upstream focus restoration and workspace focus still look for it.
- Menu copy is translated in every web locale.
- The web browser test project honors `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` so it can use a
  system Chromium, for example on NixOS.

## Dropped

The frozen July 2026 keybinding-file repair. It only rewrote an untouched generated file, and the
maintainer's file has since been customized with the fork's bindings spelled out.

## Validation Coverage

`ProjectStoreHyprnav.test.ts` (store, keep, clear, tolerate), `ProjectCommands.test.ts` (create
inherits, override, reset), contracts settings decode tests,
`NavigationCommandMenu.logic.test.ts` (ranking, grouped drafts), and
`NavigationCommandMenu.browser.test.tsx` (Ctrl+E toggle including from the search input,
arrow/Enter navigation, IME Enter, project drafts, no stacking over another surface, key isolation
from global handlers).

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `1901f64605` and the Hyprnav command case of
`c92d2e6529` (previously onto `13aa882c22` from `d71f33c62e`, itself from `31baca265e`,
`138480ee4a`, `dda9d6679a`, `a8c318729e`). Upstream deleted `LegacySidebar.tsx`, so its menu entry
is gone, and its `ProjectMutation` field test, so the Hyprnav fixture line there has no home.
