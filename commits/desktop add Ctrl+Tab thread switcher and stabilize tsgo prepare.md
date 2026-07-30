# Desktop add Ctrl+Tab thread switcher and stabilize tsgo prepare

Add a desktop Ctrl+Tab recent-thread switcher that cycles forward or backward, commits on Control release or blur, cancels on Escape, and forwards the complete gesture from embedded previews. Recent server and draft threads retain visit ordering while archived, deleted, promoted, or otherwise unavailable targets are reconciled away.

Run `effect-tsgo patch` through an idempotent, concurrency-safe wrapper so repeated or overlapping prepare executions reuse the current patch and remove stale backup buildup without racing another install.

## Validation Coverage

Desktop input, preview forwarding, IPC, recent-thread store and ordering, browser interaction, command-surface exclusion, and concurrent patch preparation are covered by focused tests.

## September upstream modernization

Keep upstream quit confirmation, sidebar animation suppression, project retention, reset sizing, preview zoom ownership, favicon handling, and destroyed-webview cleanup. Forward only the fork thread-switcher gesture, synchronously consuming its input; retain upstream preview refresh handling.
