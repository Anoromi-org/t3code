import { assert, it } from "@effect/vitest";
import { type ApplicationProjectEvent, EventId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectStore from "./ProjectStore.ts";

const projectId = ProjectId.make("project-hidden");
const at = "2026-10-25T00:00:00.000Z";

const event = (
  sequence: number,
  body: Pick<ApplicationProjectEvent, "type" | "payload">,
): ApplicationProjectEvent =>
  ({
    sequence,
    eventId: EventId.make(`event-hidden-${sequence}`),
    aggregateKind: "project",
    aggregateId: projectId,
    occurredAt: at,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    ...body,
  }) as ApplicationProjectEvent;

const created = (sequence: number, hidden?: boolean) =>
  event(sequence, {
    type: "project.created",
    payload: {
      projectId,
      title: "Learning",
      workspaceRoot: "/tmp/project-hidden",
      defaultModelSelection: null,
      scripts: [],
      ...(hidden === undefined ? {} : { hidden }),
      createdAt: at,
      updatedAt: at,
    },
  });

const metaUpdated = (sequence: number, payload: { hidden?: boolean; title?: string }) =>
  event(sequence, {
    type: "project.meta-updated",
    payload: { projectId, ...payload, updatedAt: at },
  });

it.layer(ProjectStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)))(
  "ProjectStoreV2 hidden flag",
  (it) => {
    it.effect("defaults to visible, follows updates, and survives baseline re-creation", () =>
      Effect.gen(function* () {
        const projects = yield* ProjectStore.ProjectStoreV2;
        const hiddenOf = projects
          .getShell(projectId)
          .pipe(Effect.map((shell) => Option.getOrThrow(shell).hidden));

        // Events written before the flag existed carry no `hidden`.
        yield* projects.apply(created(1));
        assert.isFalse(yield* hiddenOf);

        yield* projects.apply(metaUpdated(2, { hidden: true }));
        assert.isTrue(yield* hiddenOf);

        yield* projects.apply(metaUpdated(3, { title: "Lessons" }));
        assert.isTrue(yield* hiddenOf);

        yield* projects.apply(created(4));
        assert.isTrue(yield* hiddenOf);

        yield* projects.apply(metaUpdated(5, { hidden: false }));
        assert.isFalse(yield* hiddenOf);

        yield* projects.apply(created(6, true));
        assert.isTrue((yield* projects.get(projectId)).pipe(Option.getOrThrow).hidden);
      }),
    );
  },
);
