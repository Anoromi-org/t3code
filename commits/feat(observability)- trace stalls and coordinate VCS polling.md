# Observability trace stalls and coordinate VCS polling

Trace browser long tasks and server event-loop stalls with bounded, sanitized telemetry so application freezes can be diagnosed without recording sensitive URL contents.

Coordinate background VCS polling by the repository's normalized common Git directory and upstream remote. Worktrees retain independent local and branch status while repository-level fetch work is deduplicated per remote, globally bounded, and isolated so a missing or failing worktree cannot block healthy siblings. Scheduling honors the earliest repository-fetch, worktree-status, retry, or subscriber wake deadline; when every active worktree is backing off, the poller sleeps until the earliest retry instead of spinning on an overdue deadline. Long-animation-frame render and layout timings are omitted for frames that did not render.

## Reimplementation Sources

Reapplies fork commit `53e12c4f55` on current upstream:

- Web: upstream's `ClientTracer.layer` stays the installed runtime tracer (the fork's `ClientTracingLive` and its `runtime.ts` wiring are dropped). `clientTracer.ts` gains a `currentDelegate()` getter so long-frame spans recorded outside an Effect runtime reach the configured exporter. `startClientPerformanceTracing` starts after `configureClientTracing()` in the authenticated tracing bootstrap.
- Server: `EventLoopStallMonitor.layer` is built on top of upstream's reworked observability layer (per-signal OTLP protocol/headers). The status broadcaster rewrite keeps upstream's settings-based auto-pull policy. The fork's four-refresh global semaphore bounds repository refresh fan-out; upstream's eight-process Git limiter (#11405) still bounds individual Git processes underneath it.

## Validation Coverage

Cover client attribution sanitization, event-loop delay reporting, absolute common-directory identity, shared-worktree refresh scheduling, distinct upstream remotes, shorter worktree deadlines, per-worktree initial status, fetch deduplication, concurrency bounds, failure isolation, wake deadlines, subscriber cleanup, and non-repository fallback behavior.
