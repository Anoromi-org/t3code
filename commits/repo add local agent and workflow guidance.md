# repo add local agent and workflow guidance

## Goal

Restore repository-local automation guidance and product context without replacing upstream's current Vite+, pnpm, mobile, or vendored-reference workflows.

## Included Changes

- Appends fork sections to upstream's AGENTS.md: Vite+ completion requirements, fork rebase work, Corkdiff, and BTCA usage. Upstream already covers vendored repositories.
- Recreates `.codex/config.toml` with only the `btca_local` MCP server, since upstream removed the file.
- Adds the T3 Code rebase conflict-resolution skill for persistence, orchestration, and desktop startup work.
- Adds local frontend design and product context (DESIGN.md, PRODUCT.md, `.impeccable/`, `.agents/uncodixify/`).
- Tests the merged guidance against the current upstream workflow architecture, including desktop artifact publishing through `release-desktop.yml`.
- Fetches canonical `upstream/main` in CI so commit-note validation never mistakes a divergent fork for upstream.

## Expected Behavior

Agents have the fork-specific safety guidance while upstream workflows and package-manager conventions remain canonical. Every commit above `upstream/main` has a matching note in `commits/`.

## Reimplementation Sources

This intent folds source commits `c1a9e90cb1` and `cc3d5d796e` into the pinned upstream guidance. Capture commit `67a8281348` supplied the missing provenance notes and is represented by this completed source/test ledger rather than application behavior. Reapplied onto upstream `e4eb9977f0` from fork commit `4d56252bc2`.
