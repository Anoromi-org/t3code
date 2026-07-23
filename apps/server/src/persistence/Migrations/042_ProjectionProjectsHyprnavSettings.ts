import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const PROJECT_HYPRNAV_DEFAULT = "'null'";

export const ensureProjectionProjectHyprnavColumns = Effect.fn(
  "ensureProjectionProjectHyprnavColumns",
)(function* (sql: SqlClient.SqlClient) {
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("hyprnav_json")) {
    yield* sql.unsafe(`
      ALTER TABLE projection_projects
      ADD COLUMN hyprnav_json TEXT NOT NULL DEFAULT ${PROJECT_HYPRNAV_DEFAULT}
    `);
  }
  if (!names.has("worktree_group_titles_json")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN worktree_group_titles_json TEXT NOT NULL DEFAULT '[]'
    `;
  }

  yield* sql`
    UPDATE projection_projects
    SET hyprnav_json = 'null'
    WHERE hyprnav_json IS NULL OR trim(hyprnav_json) = ''
  `;
  yield* sql`
    UPDATE projection_projects
    SET worktree_group_titles_json = '[]'
    WHERE worktree_group_titles_json IS NULL OR trim(worktree_group_titles_json) = ''
  `;
});

export default Effect.gen(function* () {
  yield* ensureProjectionProjectHyprnavColumns(yield* SqlClient.SqlClient);
});
