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
  `orchestration` capability, like `t3_thread_list`. Both have presentation entries and are in
  Claude's read-only allowlist.
- Codex app-server and Claude processes receive `T3CODE_THREAD_ID`, plus `T3CODE_ENVIRONMENT_ID`
  when the thread has an MCP session (`provider/threadAttribution.ts`).
- `T3CODE_CODEX_THREAD_MCP_SERVER` names a configured Codex MCP server. Codex's per-thread
  config then carries `mcp_servers.<name>.env.T3CODE_THREAD_ID` (and the environment id), dotted
  keys that merge into the user's server entry. Only plain names (`[A-Za-z0-9_-]`) are accepted.
  The fork's launch-time `-c` args are gone because upstream now sends MCP config per thread.

## Dropped

The fork-only `thread-context` MCP capability; the tools gate on upstream's capabilities instead.

## Validation Coverage

`threadAttribution.test.ts` (environment layering, accepted server names, dotted overrides),
`toolkits/worktree/threadContext.test.ts` (directory matching, archive filter, newest-first order,
cursor binding), and the MCP toolkit registration and presentation checks.

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from the MCP and attribution parts of fork commit
`c5d03da9a3` ("server reconcile Codex resume and scope MCP thread context", itself from
`49fa66dbed`, `0e3a392c1b`, `7a01bd1deb`). Resume reconciliation is its own unit.
