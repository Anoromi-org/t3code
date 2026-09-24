import { assert, it } from "@effect/vitest";
import type { ProjectHyprnavSettings } from "@t3tools/contracts";

import {
  findProjectHyprnavDuplicateSlots,
  listProjectHyprnavSlots,
  projectHyprnavSettingsHasDuplicateSlots,
} from "./hyprnav.ts";

const settings = {
  bindings: [
    {
      id: "a",
      slot: 2,
      scope: "project",
      workspace: { mode: "managed" },
      action: "nothing",
    },
    {
      id: "b",
      slot: 2,
      scope: "project",
      workspace: { mode: "managed" },
      action: "nothing",
    },
    {
      id: "c",
      slot: 2,
      scope: "thread",
      workspace: { mode: "managed" },
      action: "nothing",
    },
  ],
} satisfies ProjectHyprnavSettings;

it("finds duplicate slots only within the same scope", () => {
  assert.deepEqual(listProjectHyprnavSlots(settings), [2, 2, 2]);
  assert.deepEqual(findProjectHyprnavDuplicateSlots(settings), [2]);
  assert.equal(projectHyprnavSettingsHasDuplicateSlots(settings), true);
});
