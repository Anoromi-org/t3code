# server scope MCP thread context and attribute provider work

## Goal

Agents can ask the `t3-code` MCP server which T3 Code thread they belong to and which other
threads share their working directory, and processes an agent starts can attribute their work to
the owning thread.

## Included Changes

- `get_current_thread` and `list_worktree_threads` (read-only, idempotent) join upstream's
  worktree toolkit, keeping the names agents and skills already call. They read the caller's v2
  thread shell and project. `list_worktree_threads` returns the project's threads whose worktree,
  or project root when there is none, matches the caller's, newest first, with an opaque offset
  cursor bound to the thread and archive filter. Listing other threads needs upstream's
  `orchestration` capability, like `t3_thread_list`. Upstream's thread listing no longer carries
  worktrees, so the listing reads the project's shells (active, and archived on request). Both
  tools act as the calling thread, so they are hidden from outside clients like upstream's other
  worktree tools. Both have presentation entries and are in Claude's read-only allowlist.
- Upstream now gives Codex (per-thread shell config and every stdio MCP server) and Claude
  `T3CODE_THREAD_ID`. The fork adds `T3CODE_ENVIRONMENT_ID` next to it wherever the thread has an
  MCP session (`provider/threadAttribution.ts`). The Codex replay harness ignores the new key the
  way it ignores the thread id.

## Dropped

- The fork-only `thread-context` MCP capability; the tools gate on upstream's capabilities instead.
- `T3CODE_CODEX_THREAD_MCP_SERVER`: upstream attributes every stdio MCP server in the Codex config.

## Validation Coverage

`threadAttribution.test.ts` (environment layering), the Codex per-thread config case in
`CodexAdapterV2.test.ts` (thread and environment ids for the shell and stdio servers),
`toolkits/worktree/threadContext.test.ts` (directory matching, archive filter, newest-first order,
cursor binding), `toolkits/worktree/handlers.test.ts` (caller thread, not found, paging and
archive, capability gate, read-only annotations), and Claude's read-only allowlist check.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `565c6b824a` and the MCP cases of
`c92d2e6529` (previously onto `13aa882c22` from `c5d03da9a3`). The named-server tests became
assertions on upstream's per-thread Codex config.
