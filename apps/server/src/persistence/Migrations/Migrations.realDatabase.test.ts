import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as SqliteClient from "@t3tools/shared/nodeSqliteClient";

const databasePath = process.env.T3CODE_MIGRATION_COMPAT_DB;

it.effect("migrates an explicitly supplied real database copy", () => {
  if (!databasePath) return Effect.void;

  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations();

    const ledger = yield* sql<{ readonly migrationId: number; readonly name: string }>`
      SELECT migration_id AS "migrationId", name
      FROM effect_sql_migrations
      ORDER BY migration_id
    `;
    assert.equal(ledger.at(-1)?.migrationId, 49);
    assert.equal(ledger.at(-1)?.name, "RepairForkMigrationCompatibilityV2");

    const pairingColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(auth_pairing_links)
    `;
    const sessionColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
    const projectColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_projects)
    `;
    const threadColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(projection_threads)
    `;
    const pairingNames = new Set(pairingColumns.map((column) => column.name));
    const sessionNames = new Set(sessionColumns.map((column) => column.name));
    const projectNames = new Set(projectColumns.map((column) => column.name));
    const threadNames = new Set(threadColumns.map((column) => column.name));

    assert.equal(pairingNames.has("scopes"), true);
    assert.equal(pairingNames.has("proof_key_thumbprint"), true);
    assert.equal(pairingNames.has("role"), false);
    assert.equal(sessionNames.has("scopes"), true);
    assert.equal(sessionNames.has("role"), false);
    assert.equal(projectNames.has("hyprnav_json"), true);
    assert.equal(projectNames.has("worktree_group_titles_json"), true);
    assert.equal(projectNames.has("default_model"), false);
    assert.equal(threadNames.has("fork_source_thread_id"), true);
    assert.equal(threadNames.has("snoozed_until"), true);
    assert.equal(threadNames.has("snoozed_at"), true);
    assert.equal(threadNames.has("model"), false);

    const requiredIndexes = [
      "idx_projection_projects_workspace_root_deleted_at",
      "idx_projection_threads_project_deleted_created",
      "idx_projection_threads_project_archived_at",
      "idx_projection_thread_activities_thread_sequence_created_id",
      "idx_projection_thread_messages_thread_created_id",
      "idx_projection_threads_shell_active",
      "idx_projection_threads_shell_archived",
    ];
    const indexes = yield* sql<{ readonly name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'index'
    `;
    const indexNames = new Set(indexes.map((index) => index.name));
    assert.equal(
      requiredIndexes.every((index) => indexNames.has(index)),
      true,
    );

    const quickCheck = yield* sql`PRAGMA quick_check`.values;
    assert.deepEqual(quickCheck, [["ok"]]);
  }).pipe(Effect.provide(SqliteClient.layer({ filename: databasePath })));
});
