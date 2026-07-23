import {
  DEFAULT_PROJECT_HYPRNAV_SETTINGS,
  PROJECT_HYPRNAV_CORKDIFF_ID,
  ProjectHyprnavSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const ProjectHyprnavSettingsJson = Schema.fromJsonString(ProjectHyprnavSettings);
const decodeSettingsJson = Schema.decodeUnknownSync(ProjectHyprnavSettingsJson);
const encodeSettingsJson = Schema.encodeSync(ProjectHyprnavSettingsJson);
const defaultJson = encodeSettingsJson(DEFAULT_PROJECT_HYPRNAV_SETTINGS);

export const normalizeProjectionProjectHyprnavRows = Effect.fn(
  "normalizeProjectionProjectHyprnavRows",
)(function* (sql: SqlClient.SqlClient) {
  const rows = yield* sql<{
    readonly projectId: string;
    readonly hyprnavJson: string | null;
  }>`
    SELECT project_id AS "projectId", hyprnav_json AS "hyprnavJson"
    FROM projection_projects
  `;

  for (const row of rows) {
    const normalizedJson = yield* Effect.try({
      try: () => {
        const raw = row.hyprnavJson?.trim() ?? "";
        if (raw.length === 0 || raw === "null") return "null";
        const decoded = decodeSettingsJson(raw);
        const normalized = decoded.bindings.some(
          (binding) => binding.id === PROJECT_HYPRNAV_CORKDIFF_ID,
        )
          ? decoded
          : {
              bindings: [
                ...decoded.bindings,
                ...DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.filter(
                  (binding) => binding.id === PROJECT_HYPRNAV_CORKDIFF_ID,
                ),
              ],
            };
        const encoded = encodeSettingsJson(normalized);
        return encoded === defaultJson ? "null" : encoded;
      },
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => "null"));

    yield* sql`
      UPDATE projection_projects
      SET hyprnav_json = ${normalizedJson}
      WHERE project_id = ${row.projectId}
    `;
  }
});

export default Effect.gen(function* () {
  yield* normalizeProjectionProjectHyprnavRows(yield* SqlClient.SqlClient);
});
