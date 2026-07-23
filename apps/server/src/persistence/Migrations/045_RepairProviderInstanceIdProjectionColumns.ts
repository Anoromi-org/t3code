import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const hasColumn = (columns: ReadonlyArray<{ readonly name: string }>, name: string) =>
  columns.some((column) => column.name === name);

export const ensureProviderInstanceIdProjectionColumns = Effect.fn(
  "ensureProviderInstanceIdProjectionColumns",
)(function* (sql: SqlClient.SqlClient) {
  const runtimeColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(provider_session_runtime)
  `;
  if (!hasColumn(runtimeColumns, "provider_instance_id")) {
    yield* sql`ALTER TABLE provider_session_runtime ADD COLUMN provider_instance_id TEXT`;
  }

  const projectionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_sessions)
  `;
  if (!hasColumn(projectionColumns, "provider_instance_id")) {
    yield* sql`ALTER TABLE projection_thread_sessions ADD COLUMN provider_instance_id TEXT`;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_session_runtime_instance
    ON provider_session_runtime(provider_instance_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_sessions_instance
    ON projection_thread_sessions(provider_instance_id)
  `;
});

export default Effect.gen(function* () {
  yield* ensureProviderInstanceIdProjectionColumns(yield* SqlClient.SqlClient);
});
