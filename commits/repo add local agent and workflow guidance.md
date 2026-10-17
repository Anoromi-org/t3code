# repo add local agent and workflow guidance

## Goal

Restore repository-local automation guidance and product context without replacing upstream's current Vite+, pnpm, mobile, or vendored-reference workflows.

## Included Changes

- Appends fork sections to upstream's AGENTS.md: Vite+ completion requirements, fork rebase work, Corkdiff, and BTCA usage.
- Recreates `.codex/config.toml` with only the `btca_local` MCP server.
- Adds the T3 Code rebase conflict-resolution skill. Its hotspots name the v2 database copy (`initializeV2Database.ts`), `orchestration-v2/` stores, and the fork migration ledger, and its checks use `vp` rather than `bun`.
- Adds local frontend design and product context (DESIGN.md, PRODUCT.md, `.impeccable/`, `.agents/uncodixify/`).
- Fetches canonical `upstream/main` with full history in the CI `test` job, the job that runs `scripts/` tests, so commit-note validation never mistakes a divergent fork for upstream.

## Expected Behavior

Agents have the fork-specific safety guidance while upstream workflows and package-manager conventions remain canonical. Every commit above `upstream/main` has a matching note in `commits/`.

## Validation Coverage

`scripts/repo-config.test.ts` checks the merged guidance, the rebase skill, and a note per fork commit. `scripts/workflow-config.test.ts` checks the release workflow wiring, the pnpm/Vite+ workspace, and the CI upstream fetch.

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `5de47d029c` (itself from `4d56252bc2`, `c1a9e90cb1`, `cc3d5d796e`).
