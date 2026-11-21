import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Fork migration 3: start upstream's `projection.attachment-cleanup` cursor at the lowest projector
 * watermark, because fork history holds event types (`thread.forked`) no current contract decodes
 * and a replay from 0 would block startup. Skips once upstream 063 drops `projection_state`.
 */
export const seedAttachmentCleanupCursor = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const state = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projection_state'
  `;
  if (state.length === 0) return;
  yield* sql`
    INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
    SELECT 'projection.attachment-cleanup', MIN(last_applied_sequence), MAX(updated_at)
    FROM projection_state
    WHERE projector LIKE 'projection.%'
    HAVING COUNT(*) > 0
    ON CONFLICT (projector) DO NOTHING
  `;
});
