import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Fork migration 4. Adds the per-project `hidden` flag; existing projects stay visible. */
export const ensureProjectionProjectsHidden = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
  if (columns.some((column) => column.name === "hidden")) return;
  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0
  `;
});
