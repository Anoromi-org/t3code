# Server Reconcile Codex Resume and Scope MCP Thread Context

## Goal

When a Codex session was continued outside T3 Code, resuming it in T3 Code shows the turns that happened in between. Agents can ask the `t3-code` MCP server which T3 Code thread they belong to and which other threads share their worktree. Processes an agent starts can attribute their work to the owning thread.

## Provenance

- Reimplements the behavior captured in fork commit `49fa66dbed` ("backup: capture pending modernization source"), the batched history follow-up from `5c0b447565`, and `7a01bd1deb` (Codex thread MCP attribution).
- Also carries the `T3CODE_THREAD_ID` / `T3CODE_ENVIRONMENT_ID` provider environment export from `0e3a392c1b`, because `codexThreadMcpArgs` needs the same thread id. Unit `desktop show Hyprnav desktop agents with a live window view` reuses it.
- The tunnel URL sync and `share-artifacts` changes from `49fa66dbed` landed with `add cloudflare expose`.

## Codex resume reconciliation

- Upstream resumes with `excludeTurns: true`, so history no longer comes back from `thread/resume`. After a real resume (not a fresh start after a failed resume), `CodexSessionRuntime` calls `readCodexSettledHistoryTurns`: one `thread/turns/list` page (newest 100 turns, full items) for paginated threads, or raw `thread/read` for legacy threads (last 100 turns). Each turn is decoded on its own, so a turn with an unfamiliar shape is skipped instead of failing the read. Turns keep the provider's conversation order; Codex timestamps are optional whole seconds, so they are not used for sorting. The read is best effort: failures log a warning and the session still starts.
- The settled turns are emitted once as a `thread/history` notification. `CodexAdapter` maps it to one `thread.history.reconciled` runtime event carrying a `turn.reconciled` event per turn (user and assistant text, timestamps from Codex epoch seconds, one-millisecond message offsets that never precede the previous dated turn's messages) and a `turn.proposed.completed` event per plan item. Tool transcripts are not copied.
- `ProviderRuntimeIngestion` reads the thread's turns once per batch and skips turns it already has settled. A turn T3 Code never recorded and Codex reports without any timestamp is skipped, since it cannot be placed in the conversation. Otherwise it is reconciled unless a transcript imported by the upstream agent session importer already shows it. Imported messages (`import:*` ids) keep their original timestamps but have no turn rows, so a turn that started at or before the newest imported message (`ProjectionThreadMessageRepository.getLatestImportedMessageAt`) is skipped along with its plans; the prompt that triggered the resume is not an imported message and does not count. Plans are compared against stored markdown and replayed only when missing or changed; an implemented plan keeps its implementation fields. Known limitation: a session imported while a turn was still running does not recover that turn's later reply.
- A single `turn.reconciled` dispatches `thread.turn.reconcile`, which emits `thread.message-sent` for each message and a `thread.turn-reconciled` event. A turn T3 Code started keeps its own pending user message; only the provider's assistant output is added, moved after that message when Codex's whole-second timestamp would place it earlier or is missing.
- The in-memory projector, SQL projection pipeline, and client `threadReducer` apply the same rule: a reconciled turn always updates itself (Codex reports whole seconds, so its timestamp can precede T3 Code's own), and replaces a different latest turn only when its `requestedAt` is not older, ties broken by turn id.
- `thread.turn-reconciled` is a thread-detail event: `isThreadDetailEvent` (ws.ts) delivers it on thread subscriptions and the detail watermark query in `ProjectionSnapshotQuery` counts it.
- The client `threadReducer` inserts a message it has not seen in chronological order instead of appending it, so recovered history lands before the prompt that triggered the resume, matching the SQL snapshot order. Live messages are newest and still append in constant time.
- The web notification coordinator needs no guard: resuming for a new turn sets the session to `starting` before reconciliation lands, so a reconciled completion is never observed as a fresh ready-state completion.

Deferred: reconciled turns have no checkpoints, so reverting a later T3 Code turn drops recovered messages from the thread view, and the Codex rollback turn count is derived from T3 Code checkpoints, which may not account for externally added turns. Both predate this port (fork behavior).

## MCP thread context

- New `thread-context` MCP capability, always granted with `pull-requests` by `McpSessionRegistry`. Tools `get_current_thread` and `list_worktree_threads` (read-only, idempotent) use `requireMcpCapability("thread-context")` and fail with `McpThreadContextError` or `McpCapabilityUnavailableError`.
- `McpThreadContextQuery` reads the credential's thread and lists threads in the same project and effective working directory (worktree path or project root), newest first, with an opaque cursor bound to the thread and archive filter.

## Thread attribution

- Codex and Claude provider processes receive `T3CODE_THREAD_ID`, plus `T3CODE_ENVIRONMENT_ID` when an MCP session exists, layered under the agent-device environment.
- `T3CODE_CODEX_THREAD_MCP_SERVER` names a configured Codex MCP server; `codexThreadMcpArgs` passes both ids through its `env` table (names limited to `[A-Za-z0-9_-]`). The args are prepended to the `t3-code` MCP args, or used alone when there is no MCP session. Browser and device tool availability now keys on the `t3-code` server specifically, so an attribution-only server does not advertise T3 Code tools.
- `docs/user/providers-codex.md` documents both behaviors.

## Validation

- `ProviderRuntimeIngestion.test.ts`: reconcile once, batch-check settled history and plan restore, skip undated turns and turns an imported transcript already shows, keep later external turns with the resume prompt present, preserve a T3-started turn's pending message.
- `CodexAdapter.test.ts`: timestamped reconciliation from a history batch (with a malformed turn skipped), conversation order for turns reported in the same second, plan-only turns, runtime environment and attribution args.
- `CodexSessionRuntime.test.ts`: recent settled turns returned in conversation order, skipping undecodable and in-progress turns, for paginated and legacy threads.
- `threadReducer.test.ts` tie-break, same-turn update, chronological insert of a recovered message; `McpThreadContextQuery.test.ts`; thread-context `tools.test.ts`; `McpSessionRegistry.test.ts` capability sets; `codexLaunchArgs.test.ts`.
