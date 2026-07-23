# Web restore Hyprnav settings and runtime sync

Expose Hyprnav in Settings and project/group context menus, with editable scoped bindings, validation, inheritance, grouped-project behavior, reset/save flows, and explicit runtime status.

Settings persist before best-effort desktop publication. Default changes publish to every inherited primary-local project; project changes publish project, every known worktree, and known thread scopes while leaving remote/browser projects unchanged. Browser and unit tests cover editing, validation, inheritance, cleanup, multi-worktree publication, durable-save failure behavior, and unavailable-runtime warnings.

Publication refreshes Corkdiff-backed commands before ticket expiry, retries successful publications that omit requested scopes, and validates the contract's 255-character binding-name limit before persistence.

This replacement folds the settings, routing, and save-time publication portions of source commits `ef4dc9228a` and `0c11090d7c` into current upstream project commands and sidebar structure. Their background active-thread publication, retry, ticket-refresh, and persistence-history behavior was intentionally implemented in the preceding `desktop restore Hyprnav runtime orchestration` intent so the desktop endpoint was independently usable. The superseded legacy lock-target tests are covered by the final scoped environment/runtime tests there.

The rebased implementation keeps upstream contextual project settings and the opt-in legacy sidebar: sidebar-v2 reaches Hyprnav from each project settings page, while the legacy project context menu retains its direct scoped action. Provider-setting writes remain environment-scoped and are serialized as durable functional updates so concurrent edits are not lost.
