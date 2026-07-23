import { DEFAULT_PROJECT_HYPRNAV_SETTINGS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const defaultJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))(
  DEFAULT_PROJECT_HYPRNAV_SETTINGS,
);

export const restoreInheritedProjectHyprnavNulls = (sql: SqlClient.SqlClient) =>
  sql`
    UPDATE projection_projects
    SET hyprnav_json = 'null'
    WHERE hyprnav_json IS NULL
       OR trim(hyprnav_json) = ''
       OR trim(hyprnav_json) = 'null'
       OR trim(hyprnav_json) = ${defaultJson}
  `;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* restoreInheritedProjectHyprnavNulls(sql);
});
