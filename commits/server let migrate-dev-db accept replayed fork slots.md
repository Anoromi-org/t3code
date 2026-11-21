# server let migrate-dev-db accept replayed fork slots

## Goal

`vp run migrate-dev-db` works on a real fork database, so a dev server can run on a snapshot of
the developer's data.

## Included Changes

Upstream replaced the script's slot verifier: it now copies and prunes, then relies on the
server migrator, whose guard only checks ids from the V2 cutover (55) up. Old fork releases
claimed upstream ids below that, so a fork database passes without a code change. The fork's test
stays, against upstream's flow: a source whose slot 16 holds a fork name and whose
`t3code_fork_migrations` has the `canonical-replay` row seeds normally.

## Validation Coverage

`migrate-dev-db.test.ts` ("accepts a slot the fork ledger replayed"). On 2026-11-21 a run against
a snapshot of the live database applied upstream migrations 64 to 103 and seeded the worktree.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `3ec56c1f73`; the code change is superseded
by upstream, the test is kept.
