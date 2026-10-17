# server reconcile Codex resume

## Goal

When a Codex session was continued outside T3 Code (for example from the CLI), resuming it in
T3 Code shows the turns that happened in between.

## Included Changes

- `resumeThread` takes an optional `reconcileHistory`: the native turn ids T3 Code recorded on
  the provider thread, and the latest earlier run with its root node. `ProviderTurnStartService`
  fills it from the turn-start projection. Other adapters ignore it.
- After a successful Codex resume, `codexResumeHistory.ts` reads the most recent settled turns
  (one `thread/turns/list` page of 100 for paginated threads, or `thread/read` for legacy
  threads). Each turn decodes on its own, so an unfamiliar turn is skipped, and Codex's
  conversation order is kept because its timestamps are optional whole seconds.
- Only turns after the last one T3 Code recorded are reconciled; with no recorded turn in the
  list nothing is, so history Codex copied into a forked native thread or that predates T3 Code's
  thread is never duplicated. User and assistant text become `message.updated` and
  `turn_item.updated` provider events with ids derived from the native item ids, so a repeated
  resume does not duplicate them. Tool transcripts are not copied.
- The items belong to the latest earlier run, so v2's per-run position ranges place them after
  T3 Code's last turn and before the prompt that triggered the resume. Messages get
  one-millisecond offsets from their turn's start and never precede the previous turn's.
- The read is best effort: a failure logs a warning and the session still starts.

## Known limitations

Recovered turns have no checkpoints, runs, or proposed plans. Rolling back to before them uses
T3 Code's own run count, which does not include externally added turns.

## Validation Coverage

`codexResumeHistory.test.ts` (anchor rule, text extraction, stable ids, same-second ordering,
run placement) and the adapter replay test that resumes, reads history, and emits only the turn
continued outside T3 Code.

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from the reconciliation part of fork commit `c5d03da9a3`
("server reconcile Codex resume and scope MCP thread context", itself from `49fa66dbed` and
`5c0b447565`), rebuilt for orchestration-v2: provider events and run-ranged turn item positions
replace the v1 `thread.turn.reconcile` command and projector rules.
