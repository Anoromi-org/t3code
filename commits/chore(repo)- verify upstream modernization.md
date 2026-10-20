# Verify upstream modernization

Record the 2026-10-18 modernization onto upstream `13aa882c22` (orchestration v2, Effect 4.0.5, Vite+ 1.0.0, React Compiler). The source line is `modernize/upstream-main-20260924` at `aa45061cc7`, kept as `backup/pre-modernization-20261018`.

## Units

Each fork commit was reimplemented on current upstream rather than replayed:

- Guidance, persistence, Hyprnav contracts, Corkdiff, and the Hyprnav runtime became the first five units. The Hyprnav unit folds `bcb6fdac4e`, `a9b8f60da0`, `e5957c94d0`, `0779a4cb61`, `325d0fb78d`, and `fee2ca7f9b`.
- Composer actions, project actions, fast mode and chat shortcuts, Markdown file links, the Ctrl+Tab switcher, observability, MCP thread context, Codex resume reconciliation, the SDK, and the learning contract each kept their own commit.
- Mobile identity, mobile Cloudflare Access, the Cloudflare and iOS scripts, and the desktop Electron test override were cherry-picked and adapted.
- Nix packaging folds `8378ce9ee7`, `f7966a14b6`, `b130af856d`, and `8d40963abc`.

## Dropped

- `4dd1410315` (preserve latest turn on session settlement): v2 computes the latest run from the runs table, so there is no stored pointer to clear or repair.
- `a435d65bd2` (thread resynchronization on app activation): upstream never resubscribes a deleted thread, and its tests require that; the fork's resume-from-deletion behavior contradicts it.
- Worktree branches (`0ef2aacbe7`): upstream ships worktree branch handling.
- The frozen keybinding repair: the real `keybindings.json` already lists the fork bindings explicitly.
- `61440c54ac` (background preview key presses): upstream's `bb4e4e7eca` routes agent input without moving native focus.
- The provider functional-update race fix was not reapplied to upstream's rewritten settings persistence. Rapid provider-instance edits may still drop one another; this is an open gap.
- The project actions server migration, `replaceAll` API, and `open_pr` action: the panel routes git work through upstream's git actions control.
- The VCS polling half of the observability commit: upstream coordinates polling itself.
- The SDK package build test is skipped. Declaration emit for `@t3tools/contracts` fails with TS7056, so the SDK is consumed from source.

## Persistence

Upstream copies `state.sqlite` once into `statev2.sqlite` and never writes the legacy file. Fork migrations stay: they run against `statev2.sqlite` from the fork ledger `t3code_fork_migrations`, guarded for tables upstream migration 63 drops, and fork ids are never written into `effect_sql_migrations`. The v1 thread importer carries `fork_source_*` lineage into v2 thread lineage, and projects keep `hyprnav_json`.

## Verification

- A fork server booted twice on a `VACUUM INTO` snapshot of real state. The first boot ran upstream migrations 54 to 63 with no pending fork migrations and imported 407 threads, the same count as plain upstream. All 7 forked threads kept their parent and root lineage, including a fork of a fork, and all 33 project Hyprnav overrides survived. The second boot ran no migrations and no import, and the legacy file stayed byte-identical.
- An authenticated bounded read of a forked thread over HTTP returned its title, lineage, and messages.
- Focused tests, lint, and typecheck ran for every unit, plus the learning contract suites and the repo-config note check.
- `codex review` against upstream found one issue: the Hyprnav frame proxy drained the daemon into an unbounded queue. It now reads the socket only as fast as the response consumes it, with a test that fails on the old proxy.
- The desktop and Home Manager flake checks build. A headless Xvfb launch of the package with an isolated home reached `backend ready` with no fatal errors.
- Desktop tests read `T3CODE_DESKTOP_*` from the environment, so they fail inside a session started by the local launcher; run them with those variables unset.

- An integrated browser pass on the real-data copy: the imported fork chain opens with its history, the command menu finds and opens it, project actions, `/fast` on and off, `/branch`, Hyprnav defaults and a project's slot-4 override all work, with no server or console errors.
- An audit of the fork's test cases against this branch; behavior that still ships but lost its tests is covered again in "test restore fork coverage lost in the modernization".

Not covered: desktop-only flows (Ctrl+Tab, external Corkdiff, the Hyprnav runtime) and mobile on a device.

## Validation Coverage

`scripts/repo-config.test.ts` checks that each commit above upstream has a note.
