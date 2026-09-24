import { assert, describe, it } from "@effect/vitest";

import { shouldBundleGhosttyWorktreeDependency } from "./vite.config.ts";

describe("desktop pack configuration", () => {
  it("bundles workspace imports into the standalone Ghostty helper", () => {
    assert.isTrue(shouldBundleGhosttyWorktreeDependency("@t3tools/shared/hyprland"));
    assert.isTrue(shouldBundleGhosttyWorktreeDependency("@t3tools/contracts"));
    assert.isFalse(shouldBundleGhosttyWorktreeDependency("electron"));
  });
});
