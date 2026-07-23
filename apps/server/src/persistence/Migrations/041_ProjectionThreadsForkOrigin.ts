import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const columnNames = (sql: SqlClient.SqlClient) =>
  sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`.pipe(
    Effect.map((rows) => new Set(rows.map((row) => row.name))),
  );

export const ensureProjectionThreadForkOriginColumns = Effect.fn(
  "ensureProjectionThreadForkOriginColumns",
)(function* (sql: SqlClient.SqlClient) {
  const columns = yield* columnNames(sql);

  if (columns.has("source_thread_id") && !columns.has("fork_source_thread_id")) {
    yield* sql`ALTER TABLE projection_threads RENAME COLUMN source_thread_id TO fork_source_thread_id`;
  }
  if (columns.has("source_turn_id") && !columns.has("fork_source_turn_id")) {
    yield* sql`ALTER TABLE projection_threads RENAME COLUMN source_turn_id TO fork_source_turn_id`;
  }
  if (
    columns.has("source_checkpoint_turn_count") &&
    !columns.has("fork_source_checkpoint_turn_count")
  ) {
    yield* sql`
      ALTER TABLE projection_threads
      RENAME COLUMN source_checkpoint_turn_count TO fork_source_checkpoint_turn_count
    `;
  }

  const updatedColumns = yield* columnNames(sql);
  if (!updatedColumns.has("fork_source_thread_id")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN fork_source_thread_id TEXT`;
  }
  if (!updatedColumns.has("fork_source_turn_id")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN fork_source_turn_id TEXT`;
  }
  if (!updatedColumns.has("fork_source_checkpoint_turn_count")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN fork_source_checkpoint_turn_count INTEGER`;
  }
  if (!updatedColumns.has("forked_at")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN forked_at TEXT`;
  }
});

export default Effect.gen(function* () {
  yield* ensureProjectionThreadForkOriginColumns(yield* SqlClient.SqlClient);
});
