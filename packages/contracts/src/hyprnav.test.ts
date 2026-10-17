import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DEFAULT_PROJECT_HYPRNAV_SETTINGS, ProjectHyprnavSettings } from "./hyprnav.ts";

const decode = Schema.decodeUnknownEffect(ProjectHyprnavSettings);

it.effect("normalizes legacy bindings and supplies Corkdiff", () =>
  Effect.gen(function* () {
    const settings = yield* decode({
      terminalWorktree: { slot: 3, command: null },
      openFavorite: { slot: 4, command: "nvim ." },
      corkdiff: { slot: null, command: null },
    });

    assert.deepEqual(settings, {
      bindings: [
        {
          id: "worktree-terminal",
          slot: 3,
          scope: "worktree",
          workspace: { mode: "managed" },
          action: "worktree-terminal",
        },
        {
          id: "open-favorite-editor-command",
          slot: 4,
          scope: "worktree",
          workspace: { mode: "managed" },
          action: "shell-command",
          command: "nvim .",
        },
        DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings[2],
      ],
    });
  }),
);

it.effect("defaults missing scope and workspace without overwriting explicit targets", () =>
  Effect.gen(function* () {
    const settings = yield* decode({
      bindings: [
        { id: "legacy", slot: 1, action: "nothing" },
        {
          id: "absolute",
          slot: 1,
          scope: "thread",
          workspace: { mode: "absolute", workspaceId: 9 },
          action: "nothing",
        },
      ],
    });

    assert.deepEqual(settings.bindings[0], {
      id: "legacy",
      slot: 1,
      scope: "worktree",
      workspace: { mode: "managed" },
      action: "nothing",
    });
    assert.deepEqual(settings.bindings[1]?.workspace, { mode: "absolute", workspaceId: 9 });
  }),
);

it("rejects malformed canonical bindings instead of treating them as legacy settings", () => {
  const decodeSync = Schema.decodeUnknownSync(ProjectHyprnavSettings);

  assert.throws(() => decodeSync({ bindings: "not-an-array" }));
  assert.throws(() =>
    decodeSync({ bindings: [{ id: "invalid-slot", slot: 0, action: "nothing" }] }),
  );
});
