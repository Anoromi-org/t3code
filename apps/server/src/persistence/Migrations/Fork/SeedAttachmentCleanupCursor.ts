import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Fork migration 3. Upstream's projection bootstrap keeps a separate
 * `projection.attachment-cleanup` cursor and replays history from 0 when it is
 * missing. Fork databases predate that cursor but already ran attachment
 * cleanup inline while projecting, and their history can hold event types no
 * current contract decodes (`thread.forked` from an earlier build), which would
 * fail that replay and block startup. Start the cursor at the lowest projector
 * watermark instead. Databases without projector cursors are left to upstream.
 */
export const seedAttachmentCleanupCursor = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
    SELECT 'projection.attachment-cleanup', MIN(last_applied_sequence), MAX(updated_at)
    FROM projection_state
    WHERE projector LIKE 'projection.%'
    HAVING COUNT(*) > 0
    ON CONFLICT (projector) DO NOTHING
  `;
});
