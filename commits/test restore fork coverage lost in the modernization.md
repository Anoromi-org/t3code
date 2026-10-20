# Test: restore fork coverage lost in the modernization

## Goal

An audit of every test case the fork had added or changed (111 files) against the modernized branch found fork behavior that still ships but lost its tests when upstream deleted or rewrote the files that held them. This restores that coverage on the v2 code.

## Restored

- `apps/web/src/keybindings.test.ts`: the shipped defaults Mod+E (command menu), Mod+P (project actions), Mod+Alt+Shift+P (pin), Mod+Alt+Shift+S (settle) and Mod+S (stash), each inert while a terminal has focus. The settle and copy-reference suites now resolve against `DEFAULT_RESOLVED_KEYBINDINGS`; they had been checking a local fixture that reverted to upstream's keys.
- `apps/web/src/components/ChatView.logic.test.ts`: a desktop agent's window always floats.
- `apps/server/src/orchestration-v2/ProjectCommands.test.ts` and `project/ProjectMutation.test.ts`: a new project inherits Hyprnav defaults, and an override or reset travels from the mutation into `project.meta-updated`.
- `apps/server/src/orchestration-v2/Adapters/codexResumeHistory.test.ts`: reading resumed history in both legacy and paginated modes keeps conversation order and skips running and undecodable turns.
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts`: `openSession` starts Codex with `T3CODE_THREAD_ID`, and a server named by `T3CODE_CODEX_THREAD_MCP_SERVER` receives the thread and environment ids.
- `apps/server/src/mcp/toolkits/worktree/handlers.test.ts` and `registration.test.ts`: `get_current_thread` and `list_worktree_threads` through the toolkit (effective directory, not-found caller, paging and cursor binding, archived filter, capability gate) and their read-only annotations.

## Not restored

Cases for features this modernization dropped (worktree branch generation, VCS polling coordination, the provider functional-update fix, the command-bar migration and frozen keybinding repair, latest-turn repair) or whose code path upstream replaced and covers (v1 projector repairs, the event-loop stall monitor, keybinding startup backfill). Claude's attribution environment shares the tested helper but has no adapter-level test.
