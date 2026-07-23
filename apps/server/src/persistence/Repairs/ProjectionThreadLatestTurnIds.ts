import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const repairProjectionThreadLatestTurnIds = (
  sql: SqlClient.SqlClient,
  options: { readonly backfillMissing: boolean },
) =>
  Effect.gen(function* () {
    yield* sql`
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
    `;
    yield* sql`
        WITH latest_state AS (
          SELECT
            thread.thread_id,
            (
              SELECT event.event_type
              FROM orchestration_events AS event
              WHERE event.aggregate_kind = 'thread'
                AND event.stream_id = thread.thread_id
                AND (
                  event.event_type IN ('thread.turn-diff-completed', 'thread.reverted')
                  OR (
                    event.event_type = 'thread.session-set'
                    AND json_extract(event.payload_json, '$.session.activeTurnId') IS NOT NULL
                  )
                )
              ORDER BY event.sequence DESC
              LIMIT 1
            ) AS event_type,
            (
              SELECT event.payload_json
              FROM orchestration_events AS event
              WHERE event.aggregate_kind = 'thread'
                AND event.stream_id = thread.thread_id
                AND (
                  event.event_type IN ('thread.turn-diff-completed', 'thread.reverted')
                  OR (
                    event.event_type = 'thread.session-set'
                    AND json_extract(event.payload_json, '$.session.activeTurnId') IS NOT NULL
                  )
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
            AND candidate.event_type IS NOT NULL
            AND projection_threads.latest_turn_id IS NOT candidate.turn_id
            AND (
              candidate.event_type = 'thread.reverted'
              OR EXISTS (
                SELECT 1
                FROM projection_turns AS turn
                WHERE turn.thread_id = candidate.thread_id
                  AND turn.turn_id = candidate.turn_id
              )
            )
        )
    `;
    yield* sql`
        UPDATE projection_threads
        SET has_actionable_proposed_plan = COALESCE(
          (
            SELECT plan.implemented_at IS NULL
            FROM projection_thread_proposed_plans AS plan
            WHERE plan.thread_id = projection_threads.thread_id
              AND plan.turn_id = projection_threads.latest_turn_id
            ORDER BY plan.updated_at DESC, plan.plan_id DESC
            LIMIT 1
          ),
          (
            SELECT plan.implemented_at IS NULL
            FROM projection_thread_proposed_plans AS plan
            WHERE plan.thread_id = projection_threads.thread_id
            ORDER BY plan.updated_at DESC, plan.plan_id DESC
            LIMIT 1
          ),
          0
        )
    `;
  });
