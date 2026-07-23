import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const canonicalMigrationNames = new Map<number, string>([
  [16, "CanonicalizeModelSelections"],
  [17, "ProjectionThreadsArchivedAt"],
  [18, "ProjectionThreadsArchivedAtIndex"],
  [19, "ProjectionSnapshotLookupIndexes"],
  [20, "AuthAccessManagement"],
  [21, "AuthSessionClientMetadata"],
  [22, "AuthSessionLastConnectedAt"],
  [23, "ProjectionThreadShellSummary"],
  [24, "BackfillProjectionThreadShellSummary"],
  [25, "CleanupInvalidProjectionPendingApprovals"],
  [26, "CanonicalizeModelSelectionOptions"],
  [27, "ProviderSessionRuntimeInstanceId"],
  [28, "ProjectionThreadSessionInstanceId"],
  [29, "ProjectionThreadDetailOrderingIndexes"],
  [30, "ProjectionThreadShellArchiveIndexes"],
  [31, "AuthAuthorizationScopes"],
  [32, "AuthPairingProofKeyThumbprint"],
  [33, "ProjectionThreadsSettled"],
  [34, "ProjectionThreadsSnoozed"],
  [35, "ProjectionThreadTitleRegeneration"],
  [36, "ProjectionThreadsPinned"],
  [37, "ProjectionTurnsKeysetIndex"],
  [38, "ProjectionThreadsPinOrderKey"],
  [39, "ProjectionProjectsDefaultThreadEnvMode"],
  [40, "ProjectionProjectFaviconPath"],
]);

export const hasForkMigrationLedger = Effect.fn("hasForkMigrationLedger")(function* (
  sql: SqlClient.SqlClient,
) {
  const rows = yield* sql<{ readonly migrationId: number; readonly name: string }>`
    SELECT migration_id AS "migrationId", name
    FROM effect_sql_migrations
    WHERE migration_id BETWEEN 16 AND 40
  `;
  return rows.some((row) => canonicalMigrationNames.get(row.migrationId) !== row.name);
});

export const repairProjectionThreadLatestTurnIds = (
  sql: SqlClient.SqlClient,
  options: { readonly backfillMissing: boolean },
) =>
  sql`
  UPDATE projection_threads
  SET latest_turn_id = (
    SELECT candidate.turn_id
    FROM projection_turns AS candidate
    WHERE candidate.thread_id = projection_threads.thread_id
      AND candidate.turn_id IS NOT NULL
    ORDER BY
      COALESCE(candidate.completed_at, candidate.started_at, candidate.requested_at) DESC,
      candidate.row_id DESC
    LIMIT 1
  )
  WHERE (${options.backfillMissing ? 1 : 0} = 1 OR projection_threads.latest_turn_id IS NOT NULL)
    AND NOT EXISTS (
        SELECT 1
        FROM projection_turns AS existing_turn
        WHERE existing_turn.thread_id = projection_threads.thread_id
          AND existing_turn.turn_id = projection_threads.latest_turn_id
      )
    AND EXISTS (
      SELECT 1
      FROM projection_turns AS candidate
      WHERE candidate.thread_id = projection_threads.thread_id
        AND candidate.turn_id IS NOT NULL
    )
`.pipe(
    Effect.andThen(
      sql`
      WITH latest_state AS (
        SELECT
          thread.thread_id,
          (
            SELECT event.event_type
            FROM orchestration_events AS event
            WHERE event.aggregate_kind = 'thread'
              AND event.stream_id = thread.thread_id
              AND event.event_type IN (
                'thread.session-set',
                'thread.turn-diff-completed',
                'thread.reverted'
              )
            ORDER BY event.sequence DESC
            LIMIT 1
          ) AS event_type,
          (
            SELECT event.payload_json
            FROM orchestration_events AS event
            WHERE event.aggregate_kind = 'thread'
              AND event.stream_id = thread.thread_id
              AND event.event_type IN (
                'thread.session-set',
                'thread.turn-diff-completed',
                'thread.reverted'
              )
            ORDER BY event.sequence DESC
            LIMIT 1
          ) AS payload_json
        FROM projection_threads AS thread
      ),
      candidates AS (
        SELECT
          latest_state.thread_id,
          latest_state.event_type,
          CASE latest_state.event_type
            WHEN 'thread.session-set'
            THEN json_extract(latest_state.payload_json, '$.session.activeTurnId')
            WHEN 'thread.turn-diff-completed'
            THEN json_extract(latest_state.payload_json, '$.turnId')
            WHEN 'thread.reverted'
            THEN (
              SELECT retained.turn_id
              FROM projection_turns AS retained
              WHERE retained.thread_id = latest_state.thread_id
                AND retained.turn_id IS NOT NULL
                AND retained.checkpoint_turn_count IS NOT NULL
                AND retained.checkpoint_turn_count <= json_extract(
                  latest_state.payload_json,
                  '$.turnCount'
                )
              ORDER BY retained.checkpoint_turn_count DESC, retained.row_id DESC
              LIMIT 1
            )
          END AS turn_id
        FROM latest_state
      )
      UPDATE projection_threads
      SET latest_turn_id = (
        SELECT candidate.turn_id
        FROM candidates AS candidate
        WHERE candidate.thread_id = projection_threads.thread_id
      )
      WHERE EXISTS (
          SELECT 1
          FROM candidates AS candidate
          WHERE candidate.thread_id = projection_threads.thread_id
            AND projection_threads.latest_turn_id IS NOT candidate.turn_id
            AND (
              (
                candidate.event_type = 'thread.session-set'
                AND (
                  candidate.turn_id IS NULL
                  OR EXISTS (
                    SELECT 1
                    FROM projection_turns AS turn
                    WHERE turn.thread_id = candidate.thread_id
                      AND turn.turn_id = candidate.turn_id
                  )
                )
              )
              OR (
                candidate.event_type = 'thread.turn-diff-completed'
                AND EXISTS (
                  SELECT 1
                  FROM projection_turns AS turn
                  WHERE turn.thread_id = candidate.thread_id
                    AND turn.turn_id = candidate.turn_id
                )
              )
              OR candidate.event_type = 'thread.reverted'
            )
        )
    `,
    ),
  );

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* repairProjectionThreadLatestTurnIds(sql, {
    backfillMissing: yield* hasForkMigrationLedger(sql),
  });
});
