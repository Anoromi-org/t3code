# Server Preserve Latest Turn on Session Settlement

## Goal

Keep a thread's latest non-null turn when a running provider session settles with a null active turn, so completed turns and actionable proposed plans remain reconstructable.

## Provenance

- Reimplements fork commit `5ce53209dc` (itself a rework of `7eceaa4747`) on the current upstream projection pipeline.
- Upstream now keeps `latestTurnId: activeTurnId ?? existing` in the thread projector, so the live fix is inherited. This unit keeps only the startup repair for databases whose thread projector already checkpointed a settlement that cleared the pointer.
- Upstream deleted `ProjectionStateRepository.minLastAppliedSequence`; the fork's `WHERE projector LIKE 'projection.%'` filter is obsolete. Upstream's `computeSnapshotSequence` reads only required projector names and the bootstrap cleanup boundary reads only projector and cleanup cursors, so the repair marker already stays out of both.

## Included scenarios

- Preserves the latest turn for ready, error, and interrupted settlement.
- Leaves `latestTurnId` null when no turn has ever been active.
- Reconstructs the settled turn as completed through the snapshot query.
- Keeps an unimplemented proposed plan actionable after its plan session settles.
- Runs a marker-backed (`repair.projection-threads.latest-turn-preservation.v1` in `projection_state`), targeted summary repair after projector bootstrap and before attachment-cleanup replay, without replaying historical events.
- Recomputes actionable-plan summaries after repairing historical latest-turn pointers.
- Leaves intentional canonical null pointers and incomplete histories unchanged unless a referenced turn can be reconstructed.
- Keeps the one-shot repair marker outside snapshot-sequence and cleanup-cursor calculations.

## Validation

- Focused projection-pipeline settlement regressions, including the repair marker watermark case (replaces the fork's `minLastAppliedSequence` repository test).
- The fork-ledger latest-turn backfill regression lives in `Migrations/ForkCompatibility.test.ts` (unit `server add fork-compatible persistence migrations`).
