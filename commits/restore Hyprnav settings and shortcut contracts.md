# Restore Hyprnav settings and shortcut contracts

Carry project Hyprnav overrides through orchestration commands, events, projections, persistence, and snapshots; restore client-side Hyprnav defaults and grouped settings; and assign navigation to Mod+E while retaining the upstream Mod+K command palette contract.

The startup keybinding repair rewrites only the exact previously generated Mod+E command-palette file, preserving genuinely customized configurations.

The navigation shortcut opens a scoped thread/project command menu; project results reopen an existing draft or start a new thread. While the menu is open, global application shortcuts are suspended so modal keyboard input cannot trigger background actions.

## Reimplementation Sources

This intent folds source commits `138480ee4a`, `dda9d6679a`, and `a8c318729e` into the current upstream orchestration, sidebar, draft-routing, settings, Vite+, and CI structures.

## Validation Coverage

Preserve legacy settings hydration, command/event/projection/snapshot Hyprnav round trips, exact-only keybinding migration, custom shortcut preservation, scoped thread/project ranking with inactive projects last, archived-thread filtering, grouped-project draft reuse and labeling, real Mod+E and Mod+K browser interactions, global-shortcut isolation, overlay exclusion, and CI Chromium execution.
