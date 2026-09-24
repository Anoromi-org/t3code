# Restore Hyprnav settings and shortcut contracts

Carry project Hyprnav overrides through orchestration commands, events, projections, persistence, and snapshots; restore client-side Hyprnav defaults and grouped settings; and assign navigation to Mod+E while keeping the upstream Mod+K command palette.

Project overrides stay in `projection_projects.hyprnav_json`. New projects write the inherited `null` override explicitly. Reads decode the column per row, so an override that no longer decodes falls back to inheriting defaults instead of hiding its project.

The startup keybinding repair rewrites only the exact file this fork generated in July 2026 (Mod+E opening the command palette). That file is frozen as a literal so later default changes cannot widen the match, and any customized configuration is preserved.

Mod+E opens a thread/project navigation menu; project results reopen an existing draft or start a new thread. Open command surfaces (the palette and navigation) are tagged with `data-command-surface`, and global shortcut handlers check `isAnyCommandSurfaceOpen()` so modal keyboard input cannot trigger background actions or stack another surface.

The web browser test project (Vitest + Playwright Chromium) is restored with a CI step. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a system Chromium, e.g. on NixOS.

## Reimplementation Sources

Folds fork commit `31baca265e` (itself folding `138480ee4a`, `dda9d6679a`, `a8c318729e`) and the later refinements to the navigation menu (thread status indicators, the `commandSurface` helper, the frozen legacy keybinding snapshot) into the current upstream orchestration, sidebar, draft routing, settings, Vite+, and CI structures.

## Validation Coverage

Legacy client settings hydration, command/event/projection/snapshot Hyprnav round trips including project shells, per-row decode tolerance, exact-only keybinding migration, custom shortcut preservation, scoped thread/project ranking with inactive projects last, archived-thread filtering, grouped-project draft reuse and labeling, real Mod+E and Mod+K browser interactions, global-shortcut isolation, and no palette stacking over navigation.
