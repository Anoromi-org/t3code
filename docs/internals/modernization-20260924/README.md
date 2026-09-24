# Upstream modernization, 2026-09-24

Branch: `modernize/upstream-main-20260924`. Upstream is pinned to `e4eb9977f0` (889 commits after the previous pin `4631000f5a`). The source is fork `main` at `0a11c0a52f`, kept as `backup/modernization-source-20260924` and `backup/pre-modernization-20260924`.

## Feature and test preservation

[Coverage inventory](coverage.json) maps every source commit to its rebased commit and lists every intentionally removed test case with its replacement. The baseline is every test file the fork changed since the previous pin: 109 files, 560 added cases. 545 remain under their original names; the other 15 are replaced or obsolete, as listed in the inventory.

Dropped commits: Opus 5.5 and GPT-6 Sol (upstream ships both), the pnpm `isolatedModules` tweak (no longer needed), and the two verification commits from the previous modernization (their tests live in the owning units). The 14 desktop-agent commits are one unit.

## Modernization decisions

- Upstream reclaimed migration ids 48 and 49, which fork databases had used for repairs. `migrationEntries` is exactly upstream 1–53 again. A pre-migrator step replays canonical effects whose ids fork rows occupy, and records them in `t3code_fork_migrations` without touching `effect_sql_migrations`. Fork-only schema now runs after upstream migrations under its own numbering in that table. No existing ledger row, fork column, or fork migration was removed.
- Fork migration 3 seeds upstream's attachment-cleanup cursor from existing projector cursors. Without it, the first bootstrap replays from sequence 0 and fails on legacy `thread.forked` events that no current schema decodes.
- Hyprnav project overrides stay in `projection_projects.hyprnav_json`. Their UI moved into upstream's scoped project settings page; device defaults stay on `/settings/hyprnav`.
- The fork's `thread.interrupt` became upstream's `thread.stop` with stored bindings migrated. Fork default remaps (project actions, file picker, composer focus, stop) move upstream's pin, settle and copy-reference to `mod+alt+shift+*` only where the user's file doesn't already own the key.
- The desktop-agent live view is a `desktop-agent` source on upstream's floating preview player, not a second shell. Hyprnav routes require a loopback client and a trusted origin.
- Codex resume keeps upstream's `excludeTurns` resume and reconciles settled history through a separate, per-turn tolerant read.
- The fork's tsgo patch wrapper and mobile keybinding filter are gone; upstream now covers both.
- Nix builds Electron 44 from nixpkgs, upstream's Rust capture helpers, and pre-seeds license texts for the offline web build. The desktop entry is `com.t3tools.T3Code`.

## Verification

- `vp fmt --check`, repo-wide `vp lint`, typecheck for all 16 packages, and `knip:check` pass.
- Preservation run: 2,656 passed, 2 opt-in skipped, 1 failed. The failure, `build-desktop-artifact` "skips the primary native probe for cross-architecture Windows payloads", fails identically on a clean upstream checkout.
- Real persisted-state copy: migration reaches 53 with ledger rows 1–49 byte-identical, fork ledger rows recorded, counts unchanged, integrity check ok, second run a no-op. Projection bootstrap passes twice.
- Migration tests seed fresh, upstream-at-47, upstream-at-53, pre-0905 fork, fork-main, and live-shaped ledgers.
- `nix build .#desktop` passes; packaged server, preloads, Ghostty helper, browser-secret, capture and resource-monitor helpers, icons, and desktop entry are present. A headless launch on an isolated home reaches backend ready.
- `codex review` ran per unit; valid findings were fixed. Deferred findings are recorded in the unit commit notes.

Not yet exercised: an integrated `test-t3-app` pass, and Hyprnav/Corkdiff/desktop-agent actions against a live Hyprland session.
