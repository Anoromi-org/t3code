# Upstream modernization, 2026-09-05

Branch: `modernize/upstream-main-20260905`.

Upstream is pinned to `4631000f5a7666c88402ce11a9ebb8cdef7a7dad`. The source is `backup/modernization-source-20260905` (`c33c2b9624`), which includes the original branch and its uncommitted changes. The original checkout remains separate. `backup/pre-modernization-20260905` retains its original committed head.

## Feature and test preservation

[Coverage inventory](coverage.json) maps every source commit and all 96 affected test files. Every added source test case remains represented. SQLite tests moved to `packages/shared/src/nodeSqliteClient.test.ts`. The settings patch-queue suite now tests the upstream durable client-settings queue; its four cases remain.

| Source       | Rebased      | Feature                                                         |
| ------------ | ------------ | --------------------------------------------------------------- |
| `1c562361ff` | `4d56252bc2` | repo add local agent and workflow guidance                      |
| `b5a3d858e7` | `6947b03b5e` | server add fork-compatible persistence migrations               |
| `512aa2ad2c` | `25ddb486db` | desktop add Nix packaging and local launch support              |
| `dc9e128698` | `51b40dfcd5` | desktop integrate reliable Hyprnav and Corkdiff                 |
| `2ee0c8da62` | `31baca265e` | restore Hyprnav settings and shortcut contracts                 |
| `8aa0836944` | `22fa6175e6` | desktop restore Hyprnav runtime orchestration                   |
| `f8f604945d` | `3b795bc5bd` | web restore Hyprnav settings and runtime sync                   |
| `4e02e0b720` | `4c6227a910` | web restore keyboard composer actions                           |
| `ff02634a35` | `ff68ecc6e9` | web add project actions panel                                   |
| `42ad0895e6` | `0198e373ba` | web add fast mode and chat shortcuts                            |
| `103e68c37a` | `5ce53209dc` | server preserve latest turn on session settlement               |
| `dde65177ad` | `7ee84c6f3b` | mobile configure fork release identity                          |
| `e11feafb0b` | `f8e0fd92ec` | client harden thread resynchronization on app activation        |
| `43f6158b84` | `460a1b8bf7` | web open Markdown file links in the preferred editor            |
| `90573c499f` | `e4f4a0b31b` | desktop add Ctrl+Tab thread switcher and stabilize tsgo prepare |
| `2946e912e8` | `53e12c4f55` | feat(observability): trace stalls and coordinate VCS polling    |
| `a5dc00a023` | `cc375596cc` | server generate unique idempotent worktree branches             |
| `6e5dce06b2` | `d0db9502fe` | add cloudflare expose                                           |
| `c33c2b9624` | `49fa66dbed` | backup: capture pending modernization source                    |

## Modernization decisions

- Keep upstream migrations 1–47 canonical. Migration 49 repairs historical fork collisions without rewriting applied ledger rows. Fork fields and canonical fields coexist.
- Keep upstream transactional projection and deferred attachment cleanup. Preserve settled latest turns and actionable plans; reconcile completed Codex history without duplicating pending user messages.
- Keep upstream shared settings and provider-instance capabilities, attachment uploads, background submission, remote editor links, project icons, and desktop quit handling.
- Give copy-reference, settlement, and pinning Alt-modified shortcuts to avoid the fork's composer, interrupt, and file-picker defaults. Custom bindings remain unchanged.
- Keep upstream preview zoom, favicon, and destroyed-webview behavior while forwarding desktop Ctrl+Tab gestures.
- Preserve worktree branch generation and retry recovery alongside local-only base-branch fallback and submodule checkout.
- Use Electron 43 and pnpm 11-compatible Nix dependency fetching. Preserve native browser-secret and Ghostty resources.

## Verification

- Preservation run: **1,921 passed**, 84 files, no failures. The optional real-state bootstrap fixture is skipped without its environment variable and passed separately with the snapshot. Browser files are tracked separately below.
- Real persisted-state copy: migration and projection bootstrap pass twice; event and message counts remain unchanged; SQLite integrity passes.
- Required `bun fmt`, `bun lint`, and `bun typecheck` pass after the final audit changes.
- Desktop build and full Nix package build pass. Packaged server, preload, Ghostty helper, native browser-secret helper, and icons exist.
- Isolated development startup passes; the web entry point returns HTTP 200. Live server and client settings decode with the current schemas without writing to live state.
- `codex review` completed. All three findings were fixed: recover proposed plans from resumed history, batch-check settled history before ingestion, and validate worktree completion and registration before retry reuse. Focused regressions pass, including one SQL query for 100 already-settled history entries and preservation of implemented-plan metadata.
- Eleven browser test files, integrated web validation, and desktop smoke validation await the explicit permission required by `AGENTS.md`. They remain present and are not counted as passing.
- Tunnel setup has shell syntax validation. No tunnel, credential, DNS, or running service was changed.

Browser and desktop UI checks remain pending; build and package checks have passed.
