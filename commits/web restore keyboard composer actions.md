# Web restore keyboard composer actions

Restore keyboard-only `/branch`, `/worktree`, `/reasoning`, and `/fast` composer actions on current upstream provider-instance and VCS command surfaces. Reasoning and fast mode consume the selected model's live option descriptors, preserve unrelated options, and persist sticky selections. Branch selection reuses upstream checkout/worktree rules; ref searches are debounced and exhaust their paginated results, non-repositories omit VCS actions, and named worktree branches remain separate from their resolved base refs. Sends and repeated selections wait for pending context changes, while failed or interrupted changes preserve the command for retry. The removed `/r` alias is intentionally not restored.

## Reimplementation Sources

This intent reimplements source commit `f2f2edec50` against the pinned upstream provider model descriptors, draft store, thread commands, and paginated VCS queries. It preserves upstream provider slash commands, skills, composer attachments, mobile behavior, current checkout semantics, and the legacy plan/default commands behind their upstream setting.

## Validation Coverage

Unit tests cover multiword command parsing, `/r` exclusion, live reasoning defaults and selections, fast-mode option replacement, pending-worktree base selection, toolbar invalidation of named worktree targets, separate named-worktree persistence, and interrupted mutation classification. Interrupted server metadata writes never update pending run context. Chromium coverage preserves all source scenarios and adds unresolved-base, non-repository, debounced-search, pagination, repeated-pointer, pending-submit, failed-selection, and plan-setting regressions: typed reasoning selection, prompt-injected reasoning application and cleanup, loading-safe named worktrees, the complete bare-slash action catalog, fast toggling, keyboard branch/worktree selection, plan/default gating and execution, and `/r` exclusion.
