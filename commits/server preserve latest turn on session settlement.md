# Server Preserve Latest Turn on Session Settlement

## Goal

Keep a thread's latest non-null turn when a running provider session settles with a null active turn, so completed turns and actionable proposed plans remain reconstructable.

## Provenance

- Reimplements source commit `7eceaa4747` against the current upstream projection pipeline.

## Included scenarios

- Preserves the latest turn for ready, error, and interrupted settlement.
- Leaves `latestTurnId` null when no turn has ever been active.
- Reconstructs the settled turn as completed through the snapshot query.
- Keeps an unimplemented proposed plan actionable after its plan session settles.
- Runs a marker-backed, targeted summary repair for already-checkpointed databases without replaying historical events.
- Recomputes actionable-plan summaries after repairing historical latest-turn pointers.
- Leaves intentional canonical null pointers and incomplete histories unchanged unless a referenced turn can be reconstructed.
- Keeps the one-shot repair marker outside projector watermark calculations.

## Validation

- Focused projection-pipeline settlement regressions.
- Fork-ledger migration compatibility regression.
- Startup repair against an isolated real persisted-state copy.
- Server lint and typecheck gates.
