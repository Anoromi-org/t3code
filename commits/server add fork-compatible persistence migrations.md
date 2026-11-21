# server add fork-compatible persistence migrations

## Goal

Keep the fork's persisted data (thread fork origins, Hyprnav project settings, worktree group
titles, provider instance columns, runtime indexes) on upstream's canonical migration chain,
including the 0.1.0 move to `statev2.sqlite`, without rewriting, renumbering, or deleting any
ledger row a fork database already recorded.

## Why the ledger is separate

Effect's Migrator runs only ids above the highest recorded id and ignores names. Fork builds
recorded their own migrations at canonical ids 16–22 and 26–49 on the maintainer's database.
Upstream's own V2 guard (`assertV2MigrationsCanRun`) refuses to start when an id from 55 up holds
another name, so the fork must never write `effect_sql_migrations` again. Fork bookkeeping lives in
`t3code_fork_migrations(kind, key, name, created_at)`.

## Included Changes

- Registers upstream migrations 1–103 unchanged; the fork hooks wrap upstream's per-migration
  transaction loop (replay before it, fork migrations after it). Upstream 016, 023, 033, and 034 export the
  idempotent helpers the replay reuses.
- Before the Migrator, `replaySkippedCanonicalEffects` replays upstream effects that fork rows hid,
  recording them as `canonical-replay` rows. It only acts on fork databases, identified by a
  ledger name a fork build wrote, and only on ids up to 49. A divergent ledger from any other
  build, and every id above 49, stays with upstream: preview reconciliation, the V2 guard, and a
  divergence warning.
- After an unbounded Migrator run, fork migrations 1 `ForkSchemaBaseline`, 2
  `EnsureForkSchemaColumns`, and 3 `SeedAttachmentCleanupCursor` run with insert-first locking.
  Fork migrations now always run after upstream 063 drops the v1 projections, so the baseline only
  guarantees fork-only schema once `projection_turns` is gone, and the cursor seed skips when
  `projection_state` is gone. Their full bodies remain for v1-shaped databases.
- The divergence warning omits rows whose upstream effect the fork ledger already replayed.
- The v1 thread importer reads `projection_threads.fork_source_thread_id` and imports old forks
  with v2 lineage (`relationshipToParent: "fork"`, parent, and resolved root). Origins whose source
  thread is gone import as root threads. `forkedFrom` stays null because v1 turn ids do not map to
  v2 runs.
- The lineage read goes through the read connection like the importer's other selectors.
- The test setup that strips `T3CODE_*` variables keeps `T3CODE_MIGRATION_COMPAT_DB` and
  `T3CODE_REBASE_SNAPSHOT`, otherwise the real-database checks silently skip.
- Fork baseline runs after upstream 090/091. Its auth cutover only fires when scope columns are
  missing, which never holds after the canonical chain, so 090/091 columns survive (asserted).
- Adds the Hyprnav project settings contract that the Hyprnav normalization migration decodes.
- Drops the fork's SQLite busy-snapshot retry and migration semaphore. Upstream opens write
  transactions with `BEGIN IMMEDIATE`, and the cross-process startup test passes without them.

## Compatibility

The v2 database starts as a byte copy of `state.sqlite`, so both ledgers and every fork column
come along. `state.sqlite` is never written. No `effect_sql_migrations` row is rewritten or
removed, and no fork row is written there.

## Validation Coverage

`ForkCompatibility.test.ts` covers fresh databases, upstream databases at 47 and 53, the
maintainer's live ledger shape, a fork-main database, historical divergent and partial ledgers,
bounded runs, concurrent startup across processes, second-run no-ops, preserved Hyprnav values, and
fork claims on V2 ids. `LegacyV1ForkLineage.test.ts` covers lineage import. Upstream's cutover test
proves foreign ledgers keep upstream behavior. `Migrations.realDatabase.test.ts` migrates a copy
passed through `T3CODE_MIGRATION_COMPAT_DB`, and with `T3CODE_REBASE_SNAPSHOT` copies a real
snapshot into a v2 database, imports it twice, checks fork lineage, and checks the legacy file is
untouched.

## Real-data validation (2026-11-21)

A `VACUUM INTO` copy of the live `statev2.sqlite` (upstream 63, fork 1–4, canonical-replay 34–49)
migrated through 64–103 with unchanged row counts, intact fork columns, `integrity_check` ok, and a
no-op second run. A copy of the live v1 `state.sqlite` imported into v2 with every fork origin
carried into lineage and the legacy file untouched.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `d9cb58824e` (previously onto `13aa882c22`
from `5723226342`, itself from `6947b03b5e`). The hidden-projects fork migration 4 lands with
hidden projects.
