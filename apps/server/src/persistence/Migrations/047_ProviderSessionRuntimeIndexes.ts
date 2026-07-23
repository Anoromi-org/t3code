import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const ensureProviderSessionRuntimeIndexes = (sql: SqlClient.SqlClient) =>
  Effect.all(
    [
      sql`
        CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_last_seen_thread
        ON provider_session_runtime(last_seen_at, thread_id)
      `,
      sql`
        CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_status_last_seen_thread
        ON provider_session_runtime(status, last_seen_at, thread_id)
      `,
    ],
    { concurrency: 1, discard: true },
  );

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureProviderSessionRuntimeIndexes(sql);
});
