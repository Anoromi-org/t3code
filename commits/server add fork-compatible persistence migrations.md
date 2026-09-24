# server add fork-compatible persistence migrations

## Goal

Keep the fork's persistence additions (thread fork origin, Hyprnav project settings, provider
instance columns, latest-turn repair, runtime indexes) on canonical upstream migrations 1–53
without rewriting, renumbering, or deleting any `effect_sql_migrations` row that fork databases
already recorded.

## Why the ledger moved

Effect's Migrator runs only ids above the highest recorded id and ignores names. Fork releases
recorded their own migrations at canonical ids (16–22 and 26–49 on the maintainer's database), and
upstream has since reused 48 and 49 for its own migrations. Any further fork id in
`effect_sql_migrations` would keep hiding upstream work, so fork bookkeeping now lives in its own
table and upstream's manifest is registered exactly as shipped.

## Included Changes

- Registers upstream migrations 1–53 unchanged. The previous fork-only entry at 49
  (`RepairForkMigrationCompatibilityV2`) is no longer in the manifest.
- Adds `t3code_fork_migrations(kind, key, name, created_at)`:
  - `canonical-replay`: an upstream effect replayed because a fork row claimed its id or it was
    missing below the ledger maximum.
  - `fork`: fork-only migrations with their own numbering. `1 ForkSchemaBaseline` is the former
    legacy compatibility repair; `2 EnsureForkSchemaColumns` guarantees fork-only columns and
    indexes without touching data; `3 SeedAttachmentCleanupCursor` starts upstream's
    `projection.attachment-cleanup` cursor at the lowest projector watermark when projector
    cursors exist without it. Fork history already ran that cleanup inline, and the maintainer's
    database holds `thread.forked` events from an earlier build that no contract decodes, so
    upstream's replay from 0 would fail bootstrap.
- Before the Migrator, replays skipped canonical effects under `BEGIN IMMEDIATE`: 16–40 through the
  existing idempotent prerequisite branches, 41–49 through upstream's own guarded migrations. A
  fork row claiming 50 or later fails startup loudly instead of silently skipping it. When the
  ledger holds the old V2 row at 49, 16–47 are recorded as replayed without running, because V2
  already applied them.
- After an unbounded Migrator run, runs fork migrations with insert-first locking. The baseline is
  recorded without running when a historical `RepairForkMigrationCompatibility`/`V2` row exists,
  since rerunning its Hyprnav normalization would reset saved overrides to inherited.
- Moves fork-only migration modules out of the upstream-numbered filenames into
  `Migrations/Fork/`, keeping their logic. Upstream 016, 023, 033, and 034 export the idempotent
  helpers the replay reuses.
- Keeps the in-process migration semaphore and SQLite contention retry. The shared SQLite client
  and server setup wait 10 s on competing writers.
- Adds the Hyprnav project settings contract that the Hyprnav normalization migration decodes.
  Projection read/write of `hyprnav_json` arrives with the Hyprnav contracts unit.
- Tests fresh databases, upstream databases at 47 and 53, the maintainer's live ledger shape, a
  fork-main database (canonical 1–47 plus V2 at 49), historical divergent and partial ledgers,
  bounded runs, startup contention across processes, second-run no-ops, unchanged historical rows,
  preserved Hyprnav values, and refusal to skip ids above 49. `Migrations.realDatabase.test.ts`
  migrates a copy passed through `T3CODE_MIGRATION_COMPAT_DB`; `T3CODE_REBASE_SNAPSHOT`
  bootstraps projections twice on a temp copy of a real snapshot.

## Compatibility

No existing `effect_sql_migrations` row is rewritten or removed, and no new fork row is written
there. Legacy role-bearing auth credentials are still invalidated during the upstream scope
cutover because their capabilities cannot be inferred safely.

## Reimplementation Sources

Reapplied onto upstream `e4eb9977f0` from fork commit `6947b03b5e` and later fork migration work
(`bd47655631` lineage, V2 repair at 49, contention retry, latest-turn repair). The fork's
`ProjectionState` watermark hunk is dropped because upstream removed `readMinLastAppliedSequence`.
