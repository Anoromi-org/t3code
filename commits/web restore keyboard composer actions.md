# Web restore keyboard composer actions

Restore keyboard-only `/branch`, `/worktree`, and `/reasoning` composer actions on the upstream
Tiptap composer. The items live in upstream's `composerMenuItems` and are applied through
`applyPromptReplacement`, so upstream Escape-dismiss and editor focus handling still apply.
`/reasoning` reads the selected model's live option descriptors (including the plan-mode
filtered capabilities), preserves unrelated options, persists sticky selections, and handles
prompt-injected effort (`Ultrathink:`). Branch items reuse upstream checkout and worktree rules;
ref searches are debounced and exhaust their paginated results, non-repositories omit VCS
actions, and a named worktree branch (`/worktree <name>`) is stored separately from its base
ref (`worktreeBranchName` on draft threads, pending state on empty server threads). Sends and
repeated selections wait for pending context changes, while failed or interrupted changes keep
the command for retry. The removed `/r` alias is intentionally not restored.

## Reimplementation Sources

Reimplements fork commit `4c6227a910` against upstream `e4eb9977f0`. ChatView owns a single
`runContext` prop for the composer; its `select` mirrors `BranchToolbarBranchSelector`'s
selection but awaits and reports whether the change applied, which the toolbar's open-picker
handle (`composer.branch`) cannot do. Rich-text mode keeps slash-command lines literal: marker
characters typed there skip Tiptap's markdown input rules, and ref queries read serialized `*`
back as `_`. Lexical `optimizeDeps` entries are dropped; Tiptap entries are added so browser
tests do not reload mid-run. `/fast` belongs to "web add fast mode and chat shortcuts" and
generated/unique worktree branches to "server generate unique idempotent worktree branches".

## Validation Coverage

Unit tests cover multiword command parsing, `/r` exclusion, rich-text marker normalization, live
reasoning defaults and selections, option replacement, pending-worktree base selection, toolbar
invalidation of named worktree targets, separate named-worktree persistence, and interrupted
mutation classification. Chromium coverage runs in plain and rich-text modes: typed and
prompt-injected reasoning, loading-safe named worktrees, unresolved bases, non-repositories,
debounced search, pagination, the bare-slash catalog, plan/default gating, keyboard
branch/worktree selection, background ref refreshes, unknown branches, pending and failed
selections, `/r` exclusion, and literal underscores in typed ref names.
