# Observability trace stalls and coordinate VCS polling

Trace browser long tasks and server event-loop stalls with bounded, sanitized telemetry so application freezes can be diagnosed without recording sensitive URL contents.

Coordinate background VCS polling by the repository's normalized common Git directory and upstream remote. Worktrees retain independent local and branch status while repository-level fetch work is deduplicated per remote, globally bounded, and isolated so a missing or failing worktree cannot block healthy siblings. Scheduling honors the earliest repository-fetch, worktree-status, retry, or subscriber wake deadline.

## Validation Coverage

Cover client attribution sanitization, event-loop delay reporting, absolute common-directory identity, shared-worktree refresh scheduling, distinct upstream remotes, shorter worktree deadlines, per-worktree initial status, fetch deduplication, concurrency bounds, failure isolation, wake deadlines, subscriber cleanup, and non-repository fallback behavior.
