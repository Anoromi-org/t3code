# server add fork-compatible persistence migrations

## Goal

Preserve the fork's existing persistence additions while rebasing onto canonical upstream migrations
through project favicon state at id 40 without corrupting databases that already recorded different
fork migrations at ids 34 through 42.

## Included Changes

- Keeps every upstream migration through title regeneration, thread pinning, keyset indexes, default
  thread environments, and project favicons at canonical ids 31 through 40.
- Moves the fork's thread-origin, Hyprnav project settings, projection repair, and runtime index
  migrations to ids 41 through 47.
- Adds migration 48 as an idempotent compatibility repair for databases whose historical ledger
  already occupies canonical or fork migration ids.
- Removes legacy not-null model columns after backfilling canonical model-selection JSON, so upstream projection writes remain valid on fork databases.
- Replays idempotent canonical model-option and projection-index effects whose ids were also occupied by historical fork migrations.
- Serializes the one-time compatibility preflight, retries SQLite snapshot contention during overlapping startup, and preserves bounded no-op semantics while preparing bounded forward upgrades.
- Explicitly persists inherited Hyprnav state for new projects, avoiding stale SQL defaults from historical fork databases.
- Adds shared Hyprnav contracts for legacy normalization, scoped slots, managed or absolute workspaces, and external Corkdiff defaults.
- Tests fresh databases, divergent and partial fork ledgers, databases carrying the former repair at
  id 42, bounded migration behavior, startup contention, idempotency, auth cutover, canonical
  upstream effects, and explicit real-database copies.

## Compatibility

Migration 48 does not rewrite historical ledger rows. Legacy role-bearing auth credentials are
intentionally invalidated during the upstream scope cutover because their capabilities cannot be
inferred safely.

## Reimplementation Sources

This intent reimplements source commit `bd47655631` against canonical upstream migrations through 40. Its focused scenarios are enumerated above and retained in the migration compatibility,
contention, and isolated real-database tests.

## September modernization

Canonical upstream migrations 1–47 remain registered unchanged. Historical fork migration files are retained as repair helpers, including the already shipped repair at 48. New migration 49 applies the legacy compatibility repair and every canonical effect from 41–47, without rewriting historical ledger rows. Preflight recognizes both older divergent ledgers and the current fork's collisions at 41–47. SQLite stays in upstream's shared package.

Focused migration tests cover canonical and current-fork upgrades, historical ledgers, idempotency, contention, and unchanged ledger history. The source test declarations remain present; expected canonical migration names now follow upstream.
