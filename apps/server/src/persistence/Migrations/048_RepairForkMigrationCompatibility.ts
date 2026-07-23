import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { canonicalizeLegacyModelSelectionEvents } from "./016_CanonicalizeModelSelections.ts";
import ensureProjectionThreadsArchivedAt from "./017_ProjectionThreadsArchivedAt.ts";
import ensureProjectionThreadsArchivedAtIndex from "./018_ProjectionThreadsArchivedAtIndex.ts";
import ensureProjectionSnapshotLookupIndexes from "./019_ProjectionSnapshotLookupIndexes.ts";
import ensureAuthAccessManagement from "./020_AuthAccessManagement.ts";
import ensureAuthSessionClientMetadata from "./021_AuthSessionClientMetadata.ts";
import ensureAuthSessionLastConnectedAt from "./022_AuthSessionLastConnectedAt.ts";
import { ensureProjectionThreadShellSummaryColumns } from "./023_ProjectionThreadShellSummary.ts";
import backfillProjectionThreadShellSummary from "./024_BackfillProjectionThreadShellSummary.ts";
import cleanupInvalidProjectionPendingApprovals from "./025_CleanupInvalidProjectionPendingApprovals.ts";
import canonicalizeModelSelectionOptions from "./026_CanonicalizeModelSelectionOptions.ts";
import ensureProviderSessionRuntimeInstanceId from "./027_ProviderSessionRuntimeInstanceId.ts";
import ensureProjectionThreadSessionInstanceId from "./028_ProjectionThreadSessionInstanceId.ts";
import ensureProjectionThreadDetailOrderingIndexes from "./029_ProjectionThreadDetailOrderingIndexes.ts";
import ensureProjectionThreadShellArchiveIndexes from "./030_ProjectionThreadShellArchiveIndexes.ts";
import { ensureProjectionThreadsSettled } from "./033_ProjectionThreadsSettled.ts";
import { ensureProjectionThreadsSnoozed } from "./034_ProjectionThreadsSnoozed.ts";
import ensureProjectionThreadTitleRegeneration from "./035_ProjectionThreadTitleRegeneration.ts";
import ensureProjectionThreadsPinned from "./036_ProjectionThreadsPinned.ts";
import ensureProjectionTurnsKeysetIndex from "./037_ProjectionTurnsKeysetIndex.ts";
import ensureProjectionThreadsPinOrderKey from "./038_ProjectionThreadsPinOrderKey.ts";
import ensureProjectionProjectsDefaultThreadEnvMode from "./039_ProjectionProjectsDefaultThreadEnvMode.ts";
import ensureProjectionProjectFaviconPath from "./040_ProjectionProjectFaviconPath.ts";
import { ensureProjectionThreadForkOriginColumns } from "./041_ProjectionThreadsForkOrigin.ts";
import { ensureProjectionProjectHyprnavColumns } from "./042_ProjectionProjectsHyprnavSettings.ts";
import { normalizeProjectionProjectHyprnavRows } from "./043_NormalizeProjectHyprnavScopes.ts";
import { restoreInheritedProjectHyprnavNulls } from "./044_RestoreInheritedProjectHyprnavNulls.ts";
import { ensureProviderInstanceIdProjectionColumns } from "./045_RepairProviderInstanceIdProjectionColumns.ts";
import { hasForkMigrationLedger } from "./046_RepairProjectionThreadLatestTurnIds.ts";
import { ensureProviderSessionRuntimeIndexes } from "./047_ProviderSessionRuntimeIndexes.ts";
import { repairProjectionThreadLatestTurnIds } from "../Repairs/ProjectionThreadLatestTurnIds.ts";

const requiredPairingColumns = [
  "id",
  "credential",
  "method",
  "scopes",
  "subject",
  "label",
  "created_at",
  "expires_at",
  "consumed_at",
  "revoked_at",
] as const;

const requiredSessionColumns = [
  "session_id",
  "subject",
  "scopes",
  "method",
  "client_label",
  "client_ip_address",
  "client_user_agent",
  "client_device_type",
  "client_os",
  "client_browser",
  "issued_at",
  "expires_at",
  "last_connected_at",
  "revoked_at",
] as const;

const includesEvery = (actual: Set<string>, required: readonly string[]) =>
  required.every((column) => actual.has(column));

const ensureLegacyModelSelectionJsonColumns = Effect.fn("ensureLegacyModelSelectionJsonColumns")(
  function* (sql: SqlClient.SqlClient) {
    const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
    const projectNames = new Set(projectColumns.map((column) => column.name));
    if (!projectNames.has("default_model_selection_json")) {
      yield* sql`ALTER TABLE projection_projects ADD COLUMN default_model_selection_json TEXT`;
      projectNames.add("default_model_selection_json");
    }
    if (projectNames.has("default_model") && projectNames.has("default_model_selection_json")) {
      yield* sql`
      UPDATE projection_projects
      SET default_model_selection_json = CASE
        WHEN default_model IS NULL THEN NULL
        ELSE json_object(
          'provider',
          CASE WHEN lower(default_model) LIKE '%claude%' THEN 'claudeAgent' ELSE 'codex' END,
          'model',
          default_model
        )
      END
      WHERE default_model_selection_json IS NULL
    `;
    }

    const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
    const threadNames = new Set(threadColumns.map((column) => column.name));
    if (!threadNames.has("model_selection_json")) {
      yield* sql`ALTER TABLE projection_threads ADD COLUMN model_selection_json TEXT`;
      threadNames.add("model_selection_json");
    }
    if (threadNames.has("model") && threadNames.has("model_selection_json")) {
      yield* sql`
      UPDATE projection_threads
      SET model_selection_json = json_object(
        'provider',
        COALESCE(
          (
            SELECT provider_name
            FROM projection_thread_sessions
            WHERE projection_thread_sessions.thread_id = projection_threads.thread_id
          ),
          CASE WHEN lower(model) LIKE '%claude%' THEN 'claudeAgent' ELSE 'codex' END,
          'codex'
        ),
        'model',
        model
      )
      WHERE model_selection_json IS NULL
    `;
    }
  },
);

const dropLegacyModelSelectionColumns = Effect.fn("dropLegacyModelSelectionColumns")(function* (
  sql: SqlClient.SqlClient,
) {
  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  if (projectColumns.some((column) => column.name === "default_model")) {
    yield* sql`ALTER TABLE projection_projects DROP COLUMN default_model`;
  }

  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (threadColumns.some((column) => column.name === "model")) {
    yield* sql`ALTER TABLE projection_threads DROP COLUMN model`;
  }
});

const ensureCurrentAuthSchema = Effect.fn("ensureCurrentAuthSchema")(function* (
  sql: SqlClient.SqlClient,
  options: { readonly includeProofKey: boolean } = { includeProofKey: true },
) {
  const pairingColumns = yield* sql<{
    readonly name: string;
  }>`PRAGMA table_info(auth_pairing_links)`;
  const sessionColumns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
  const pairingNames = new Set(pairingColumns.map((column) => column.name));
  const sessionNames = new Set(sessionColumns.map((column) => column.name));
  const requiresScopeCutover =
    !includesEvery(pairingNames, requiredPairingColumns) ||
    !includesEvery(sessionNames, requiredSessionColumns);

  if (requiresScopeCutover) {
    // Deliberately invalidate legacy role-bearing credentials. There is no
    // safe implicit mapping from a role to the newer capability scopes.
    yield* sql`DROP TABLE IF EXISTS auth_pairing_links`;
    yield* sql`DROP TABLE IF EXISTS auth_sessions`;
    yield* sql`
      CREATE TABLE auth_pairing_links (
        id TEXT PRIMARY KEY,
        credential TEXT NOT NULL UNIQUE,
        method TEXT NOT NULL,
        scopes TEXT NOT NULL,
        subject TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        revoked_at TEXT
      )
    `;
    yield* sql`
      CREATE TABLE auth_sessions (
        session_id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        scopes TEXT NOT NULL,
        method TEXT NOT NULL,
        client_label TEXT,
        client_ip_address TEXT,
        client_user_agent TEXT,
        client_device_type TEXT NOT NULL DEFAULT 'unknown',
        client_os TEXT,
        client_browser TEXT,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_connected_at TEXT,
        revoked_at TEXT
      )
    `;
  }

  if (options.includeProofKey) {
    const currentPairingColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(auth_pairing_links)
    `;
    if (!currentPairingColumns.some((column) => column.name === "proof_key_thumbprint")) {
      yield* sql`ALTER TABLE auth_pairing_links ADD COLUMN proof_key_thumbprint TEXT`;
    }
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_auth_pairing_links_active
    ON auth_pairing_links(revoked_at, consumed_at, expires_at)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
    ON auth_sessions(revoked_at, expires_at, issued_at)
  `;
});

/**
 * Creates schema required by canonical migrations that run before migration
 * 48 can repair colliding fork ledger ids.
 */
export const prepareForkMigrationPrerequisites = Effect.fn("prepareForkMigrationPrerequisites")(
  function* (sql: SqlClient.SqlClient, throughId: number) {
    if (throughId >= 16) {
      yield* ensureLegacyModelSelectionJsonColumns(sql);
      yield* canonicalizeLegacyModelSelectionEvents(sql);
      yield* dropLegacyModelSelectionColumns(sql);
    }
    if (throughId >= 17) yield* ensureProjectionThreadsArchivedAt;
    if (throughId >= 18) yield* ensureProjectionThreadsArchivedAtIndex;
    if (throughId >= 19) yield* ensureProjectionSnapshotLookupIndexes;
    if (throughId >= 20 && throughId < 31) yield* ensureAuthAccessManagement;
    if (throughId >= 21 && throughId < 31) yield* ensureAuthSessionClientMetadata;
    if (throughId >= 22 && throughId < 31) yield* ensureAuthSessionLastConnectedAt;
    if (throughId >= 23) yield* ensureProjectionThreadShellSummaryColumns(sql);
    if (throughId >= 24) yield* backfillProjectionThreadShellSummary;
    if (throughId >= 25) yield* cleanupInvalidProjectionPendingApprovals;
    if (throughId >= 26) yield* canonicalizeModelSelectionOptions;
    if (throughId >= 27) yield* ensureProviderSessionRuntimeInstanceId;
    if (throughId >= 28) yield* ensureProjectionThreadSessionInstanceId;
    if (throughId >= 29) yield* ensureProjectionThreadDetailOrderingIndexes;
    if (throughId >= 30) yield* ensureProjectionThreadShellArchiveIndexes;
    if (throughId >= 31) {
      yield* ensureCurrentAuthSchema(sql, { includeProofKey: throughId >= 32 });
    }
    if (throughId >= 33) yield* ensureProjectionThreadsSettled(sql);
    if (throughId >= 34) yield* ensureProjectionThreadsSnoozed(sql);
    if (throughId >= 35) yield* ensureProjectionThreadTitleRegeneration;
    if (throughId >= 36) yield* ensureProjectionThreadsPinned;
    if (throughId >= 37) yield* ensureProjectionTurnsKeysetIndex;
    if (throughId >= 38) yield* ensureProjectionThreadsPinOrderKey;
    if (throughId >= 39) yield* ensureProjectionProjectsDefaultThreadEnvMode;
    if (throughId >= 40) yield* ensureProjectionProjectFaviconPath;
    if (throughId >= 41) yield* ensureProjectionThreadForkOriginColumns(sql);
    if (throughId >= 42) yield* ensureProjectionProjectHyprnavColumns(sql);
    if (throughId >= 43) yield* normalizeProjectionProjectHyprnavRows(sql);
    if (throughId >= 44) yield* restoreInheritedProjectHyprnavNulls(sql);
    if (throughId >= 45) yield* ensureProviderInstanceIdProjectionColumns(sql);
    if (throughId >= 46) {
      yield* repairProjectionThreadLatestTurnIds(sql, {
        backfillMissing: yield* hasForkMigrationLedger(sql),
      });
    }
    if (throughId >= 47) yield* ensureProviderSessionRuntimeIndexes(sql);
  },
);

/**
 * Repairs databases whose migration ids were claimed by either the historical
 * fork or the previous rebuild's 33-40 sequence. The historical ledger remains
 * untouched; every schema operation is idempotent and converges the database on
 * the canonical upstream + fork shape.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureCurrentAuthSchema(sql);
  yield* ensureProjectionThreadsSettled(sql);
  yield* ensureProjectionThreadsSnoozed(sql);
  yield* ensureProjectionThreadTitleRegeneration;
  yield* ensureProjectionThreadsPinned;
  yield* ensureProjectionTurnsKeysetIndex;
  yield* ensureProjectionThreadsPinOrderKey;
  yield* ensureProjectionProjectsDefaultThreadEnvMode;
  yield* ensureProjectionProjectFaviconPath;
  yield* ensureProjectionThreadForkOriginColumns(sql);
  yield* ensureProjectionProjectHyprnavColumns(sql);
  yield* ensureProjectionThreadsArchivedAt;
  yield* ensureLegacyModelSelectionJsonColumns(sql);
  yield* dropLegacyModelSelectionColumns(sql);
  yield* canonicalizeModelSelectionOptions;
  yield* normalizeProjectionProjectHyprnavRows(sql);
  yield* restoreInheritedProjectHyprnavNulls(sql);
  yield* ensureProviderInstanceIdProjectionColumns(sql);
  yield* repairProjectionThreadLatestTurnIds(sql, {
    backfillMissing: yield* hasForkMigrationLedger(sql),
  });
  yield* ensureProviderSessionRuntimeIndexes(sql);
  yield* ensureProjectionThreadsArchivedAtIndex;
  yield* ensureProjectionSnapshotLookupIndexes;
  yield* ensureProjectionThreadDetailOrderingIndexes;
  yield* ensureProjectionThreadShellArchiveIndexes;
});
