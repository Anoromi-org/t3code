# repo add local agent and workflow guidance

## Goal

Restore repository-local automation guidance and product context without replacing upstream's current Vite+, pnpm, mobile, or vendored-reference workflows.

## Included Changes

- Adds AGENTS, Codex, and BTCA guidance for repository-specific agent behavior.
- Adds the T3 Code rebase conflict-resolution skill for persistence, orchestration, and desktop startup work.
- Adds local frontend design and product context.
- Tests the merged guidance against the current upstream workflow architecture.
- Fetches canonical `upstream/main` in CI so commit-note validation never mistakes a divergent fork for upstream.

## Expected Behavior

Agents have the fork-specific safety guidance while upstream workflows and package-manager conventions remain canonical.

## Reimplementation Sources

This intent folds source commits `c1a9e90cb1` and `cc3d5d796e` into the pinned upstream guidance. Capture commit `67a8281348` supplied the missing provenance notes and is represented by this completed source/test ledger rather than application behavior.
