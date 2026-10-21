# server let migrate-dev-db accept replayed fork slots

## Goal

`vp run migrate-dev-db` works on a real fork database, so a dev server can run on a snapshot of
the developer's data.

## Included Changes

- `verifyMigrationSlots` skips a slot whose name differs from the code manifest when
  `t3code_fork_migrations` has a `canonical-replay` row for it. Old fork releases claimed upstream
  ids in `effect_sql_migrations`; the fork ledger records that the upstream migration for that id
  was replayed, so the slot is not a collision.
- A test covers a renamed slot with a replay row.

## Validation Coverage

`migrate-dev-db.test.ts` (8 tests). A snapshot of the live database, which failed at slot 16
(`ProjectionThreadsForkOrigin` vs `CanonicalizeModelSelections`), now builds.
