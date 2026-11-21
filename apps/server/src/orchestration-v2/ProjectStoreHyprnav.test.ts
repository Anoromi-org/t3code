import { assert, it } from "@effect/vitest";
import {
  type ApplicationProjectEvent,
  DEFAULT_PROJECT_HYPRNAV_SETTINGS,
  EventId,
  ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";

const projectId = ProjectId.make("project-hyprnav");
const at = "2026-03-24T00:00:00.000Z";
const override = { ...DEFAULT_PROJECT_HYPRNAV_SETTINGS, bindings: [] };

const event = (
  sequence: number,
  body: Pick<ApplicationProjectEvent, "type" | "payload">,
): ApplicationProjectEvent =>
  ({
    sequence,
    eventId: EventId.make(`event-hyprnav-${sequence}`),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: at,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    ...body,
  }) as ApplicationProjectEvent;

const created = (sequence: number, hyprnav?: typeof override | null) =>
  event(sequence, {
    type: "project.created",
    payload: {
      projectId,
      title: "Hyprnav project",
      workspaceRoot: "/tmp/project-hyprnav",
      defaultModelSelection: null,
      scripts: [],
      ...(hyprnav === undefined ? {} : { hyprnav }),
      createdAt: at,
      updatedAt: at,
    },
  });

it.layer(ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)))(
  "ProjectStoreV2 Hyprnav overrides",
  (it) => {
    it.effect("stores, keeps, clears, and tolerates project Hyprnav overrides", () =>
      Effect.gen(function* () {
        const projects = yield* ProjectStore.ProjectStoreV2;
        const sql = yield* SqlClient.SqlClient;
        const hyprnavOf = projects
          .getShell(projectId)
          .pipe(Effect.map((shell) => Option.getOrThrow(shell).hyprnav));

        yield* projects.apply(created(1));
        assert.isNull(yield* hyprnavOf);

        yield* projects.apply(
          event(2, {
            type: "project.meta-updated",
            payload: { projectId, hyprnav: override, updatedAt: at },
          }),
        );
        assert.deepEqual(yield* hyprnavOf, override);

        // A baseline re-creation without an override keeps the stored one.
        yield* projects.apply(created(3));
        assert.deepEqual(yield* hyprnavOf, override);

        yield* projects.apply(
          event(4, {
            type: "project.meta-updated",
            payload: { projectId, hyprnav: null, updatedAt: at },
          }),
        );
        assert.isNull(yield* hyprnavOf);

        yield* sql`
          UPDATE projection_projects SET hyprnav_json = '{"bindings":"broken"}'
          WHERE project_id = ${projectId}
        `;
        assert.isNull(yield* hyprnavOf);
        assert.lengthOf(yield* projects.listShells(), 1);
      }),
    );
  },
);
