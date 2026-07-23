import { assert, it } from "@effect/vitest";
import * as SqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import repairLegacyFork from "./048_RepairForkMigrationCompatibility.ts";

const historicalNames = [
  "ProjectionThreadsForkOrigin",
  "ProjectionProjectsHyprnavSettings",
  "NormalizeProjectHyprnavScopes",
  "RestoreInheritedProjectHyprnavNulls",
  "RepairProviderInstanceIdProjectionColumns",
  "RepairProjectionThreadLatestTurnIds",
  "ProviderSessionRuntimeIndexes",
  "RepairForkMigrationCompatibility",
];

for (const source of ["canonical", "fork"] as const) {
  it.effect(`upgrades the ${source} ledger without losing either schema or rewriting history`, () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: source === "canonical" ? 47 : 40 });
      if (source === "fork") {
        yield* repairLegacyFork;
        for (const [offset, name] of historicalNames.entries()) {
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${41 + offset}, ${name})`;
        }
      }
      const before = yield* sql`SELECT * FROM effect_sql_migrations ORDER BY migration_id`;
      const executed = yield* runMigrations();
      assert.deepEqual(executed, [[49, "RepairForkMigrationCompatibilityV2"]]);
      const historical =
        yield* sql`SELECT * FROM effect_sql_migrations WHERE migration_id < 49 ORDER BY migration_id`;
      assert.deepEqual(historical, before);

      for (const [table, required] of [
        ["auth_sessions", ["client_surface", "client_app_version"]],
        [
          "projection_projects",
          ["auto_pull", "project_icon_json", "hyprnav_json", "worktree_group_titles_json"],
        ],
        [
          "projection_threads",
          ["linked_pull_request_json", "unsettled_at", "fork_source_thread_id"],
        ],
      ] as const) {
        const columns = yield* sql<{
          readonly name: string;
        }>`PRAGMA table_info(${sql.literal(table)})`;
        for (const column of required)
          assert.equal(
            columns.some((row) => row.name === column),
            true,
            `${table}.${column}`,
          );
      }
      assert.deepEqual(yield* runMigrations(), []);
      assert.deepEqual(yield* sql`PRAGMA quick_check`.values, [["ok"]]);
    }).pipe(Effect.provide(SqliteClient.layerMemory())),
  );
}
