---
name: t3code-rebase-conflict-resolution
description: Resolve rebase conflicts and post-rebase regressions in T3 Code. Use when rebasing onto upstream/main or another long-lived branch changes persistence, migrations, orchestration events, projection schemas, settings, sidebar structure, or desktop startup behavior, and the branch must be reconciled onto upstream implementations instead of reviving stale local code.
---

# T3code Rebase Conflict Resolution

Rebase T3 Code onto upstream behavior without breaking persisted state, desktop startup, or read-model-driven UI. Prefer upstream architectures when they already replaced the branch version.

## Workflow

1. Inspect the rebase surface before editing.
   Run `git diff --name-only --diff-filter=U`.
   Search for conflict markers with `rg -n '<<<<<<<|=======|>>>>>>>'`.
   Read the surrounding upstream implementation before choosing a side.

2. Recover branch commit intent before reimplementing.
   For each paused rebase commit or conflict cluster, first try to find a matching commit note at `commits/<sanitized full commit subject>.md`.
   Use the commit subject, not the hash, because hashes may change during rebases and amendments. Sanitize characters forbidden in Windows filenames (`<>:"/\\|?*` and control characters) to `-`, and trim trailing dots or spaces; this is the same mapping enforced by `scripts/repo-config.test.ts`.
   If a matching note exists, read its feature goal, implementation summary, reimplementation notes, and expected behavioral results before resolving conflicts.
   Treat the note as the source of intended behavior, not as an instruction to revive the old code literally.
   Reimplement the feature against the new upstream code, adjusting service wiring, schemas, UI state, tests, and persistence behavior to match the current codebase.
   Preserve the expected behavioral results from the note unless upstream/main already provides equivalent behavior or the behavior is intentionally superseded by a later commit in the stack.
   If no matching note exists, fall back to `git show`, nearby commits, tests, and current code context.

3. Rebase onto upstream implementations, not deleted local subsystems.
   Treat `upstream/main` as the primary source of truth when branch code and upstream differ.
   If upstream replaced a module, route, settings store, or persistence shape, keep the upstream architecture and re-apply the branch feature onto it.
   If upstream/main already implements the same user-visible capability, adapt the branch to use the upstream implementation or drop the branch-specific version entirely.
   Do not preserve branch-local implementations just because they exist on `main`; preserve the feature, but realize it through upstream/main when upstream already has a solution.
   Never drop a feature that exists on `upstream/main`.
   Treat deleted files as suspect until you confirm they were not intentionally superseded.

4. Resolve conflicts in validation-sized increments, not just until `git rebase --continue` unblocks.
   After each substantial conflict resolution, stop and validate before continuing the rebase.
   Prefer the smallest useful validation first:
   1. format the touched files
   2. run lint/typecheck on the affected package or file set
   3. run focused tests for the code you just reconciled
      Only move to the next rebase stop once the current resolution is coherent against the live upstream APIs it now targets.
      Do not defer obvious integration fallout until the end of the full rebase.
      If a paused rebase commit is known to be incomplete until a later commit in the stack lands, document that explicitly and still run the narrowest checks that are expected to pass.

5. Audit compatibility surfaces explicitly.
   Check migrations for numbering drift versus upstream.
   Compare the intended migration order against `upstream/main`, not only the current branch.
   Diff the actual `migrationEntries` list against `upstream/main` before resolving any migration conflict.
   Treat "upstream had migration A at id N, branch had migration B at id N" as a release-blocking problem, not a normal conflict.
   Never drop an upstream migration from the active chain just because the branch reused that numeric slot for something else.
   Inspect a copied real database's `effect_sql_migrations` ledger and actual schema together.
   If a forked database already used a migration ID for a different migration than `upstream/main`, restore canonical upstream numbering in code for fresh databases and add a new repair migration after the canonical tip for already-affected databases.
   Explicitly model both upgrade directions when persistence changed:
   1. a database created from canonical `upstream/main`
   2. a database created from the branch or another fork that reused migration IDs
      Prove both can reach the rebased schema without manual intervention.
      Check orchestration event types and payload shapes for legacy rows.
      Check projection tables and snapshot queries for mixed old/new schemas.
      Check settings and local storage migrations when web state models changed.
      Check sidebar or routing logic when upstream changed grouping, ordering, or thread/project shapes.

6. Preserve mixed-schema compatibility during the transition.
   Keep read paths tolerant of old persisted shapes.
   Keep write paths compatible with legacy not-null or still-present scalar columns until migrations are proven on real data.
   Normalize legacy event payloads during replay instead of assuming all rows were rewritten.
   Make repair migrations idempotent and schema-driven: inspect real columns/data, add missing columns, backfill from legacy fields, and normalize old persisted payloads as needed.

7. Validate on real state, not only clean fixtures.
   Run `bun fmt`, `bun lint`, and `bun typecheck`.
   Run focused `bun run test ...` regressions for every compatibility patch.
   If migrations changed, add or update tests that seed:
   1. an `upstream/main`-shaped migration ledger and schema
   2. a branch/fork-shaped migration ledger and schema
      Do not declare the rebase done until both pass.
      If persistence or startup was touched, smoke boot the desktop app.
      If available, use an isolated copy of a real database snapshot rather than only an empty dev DB.
      Treat a successful boot on an empty database as insufficient evidence when the rebase touched migrations, projections, or startup persistence.

## T3 Code Hotspots

- `apps/server/src/persistence/Migrations.ts` and `apps/server/src/persistence/Migrations/`
- `apps/server/src/persistence/Layers/OrchestrationEventStore.ts`
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`
- `apps/server/src/persistence/Layers/ProjectionProjects.ts`
- `apps/server/src/persistence/Layers/ProjectionThreads.ts`
- `apps/web/src/components/Sidebar.logic.ts`
- `apps/web/src/components/Sidebar.tsx`
- `apps/web/src/routes/` and settings/model-selection hooks

## Decision Rules

- Do not treat a clean git index as proof that the rebase is finished.
- Do treat upstream/main feature parity as mandatory: do not drop upstream behavior while resolving conflicts.
- Do prefer upstream/main implementations over branch-local alternatives when both solve the same problem.
- Do re-apply branch-only value on top of upstream/main only when upstream does not already provide the capability.
- Do not use "Git accepted the conflict resolution" as the bar for correctness; use passing validation at each major rebase stop.
- Do run incremental validation before `git rebase --continue` whenever a conflict changes contracts, state ownership, service wiring, routing, persistence, or tests.
- Do prefer targeted checks during the paused rebase and reserve full `bun fmt` / `bun lint` / `bun typecheck` for major checkpoints and final sign-off.
- Do not renumber or reuse migrations without checking upstream IDs first.
- Do not replace upstream migration IDs with branch-specific ones in `migrationEntries`; preserve canonical upstream history and repair branch-specific drift additively after it.
- Do not trust `effect_sql_migrations` alone when forked databases may have recorded the wrong migration under a reused ID.
- Do not repair shipped databases by rewriting old migration IDs in place; prefer additive repair migrations after the canonical upstream sequence.
- Do not sign off a persistence-related rebase until you have validated both fresh-database behavior and upgraded-database behavior.
- Do not assume production snapshots match the newest projection schema.
- Do not reintroduce old settings or state modules if upstream already replaced them.
- Do not keep a branch-specific implementation when upstream/main already has an equivalent feature unless the branch version adds intentional, still-needed behavior on top.
- Do add regression tests immediately when a copied real database exposes a bug.
