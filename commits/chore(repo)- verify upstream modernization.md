# Verify upstream modernization

Record the 2026-11-21 modernization onto upstream `721542cac7` (Node 26, pnpm 12, Vite+ 1.4, upstream
migrations 64 to 103, required translations). The source line is fork `main` at `b91722ee92`, kept
as `backup/pre-modernization-20261121`.

## Units

Each fork commit was reimplemented on current upstream rather than replayed, one commit per fork
commit with the same subject and a note. "test restore fork coverage lost in the modernization"
has no commit of its own: its cases moved into the units whose behavior they cover. The two
`fix(nix)` commits fold into Nix packaging.

## Test retention

Every test case the fork added above upstream (547) maps to a test on this branch, except the 14
voice call cases, removed with that feature at the owner's request: 526 under the same title, 6
rewritten against the upstream code that replaced their target, 1 merged into an upstream test. No new skips; the SDK packaging tests stay skipped because upstream's largest
contract exports still exceed TypeScript's declaration limit (TS7056). Where upstream deleted the
file holding a fork case, the case moved to the nearest upstream test or a fork-only file.

## Persistence

Fork migrations stay in `t3code_fork_migrations` and run after upstream's per-migration loop.
`hidden` is optional on project contracts, like upstream's pin and archive times.

## Verification

- `VACUUM INTO` copies of the live `statev2.sqlite` (upstream 63, fork 1 to 4) migrate through 103
  with unchanged counts, intact fork columns, `integrity_check` ok, and a no-op second run; the live
  v1 `state.sqlite` imports into v2 with every fork origin carried into lineage. `vp run
  migrate-dev-db` seeds a worktree from the live data.
- Typecheck for contracts, shared, client-runtime, provider-core, effect-codex-app-server, server,
  web, desktop, mobile, sdk, and scripts.
- Every fork-added or fork-modified test file: 123 node files (2,545 tests) and 11 browser files
  (72 tests) pass.
- `nix build .#desktop` and `nix flake check` pass on x86_64-linux.
- `codex review` against upstream found one issue, in the voice calls since removed.

Not covered: an integrated browser pass, desktop-only flows (Ctrl+Tab, external Corkdiff, the
Hyprnav runtime) in the packaged app, aarch64 Nix, and mobile on a device.

## Validation Coverage

`scripts/repo-config.test.ts` checks that each commit above upstream has a note.
