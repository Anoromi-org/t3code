import { ThreadId } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import { describe, expect, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";

import { findClientAddressForClasses, make } from "./DesktopFocus.ts";

describe("DesktopFocus", () => {
  it("finds the desktop by current or initial WM class", () => {
    expect(
      findClientAddressForClasses(
        [{ address: "0xabc", initialClass: "t3-code-alpha" }],
        new Set(["t3code", "t3-code-alpha"]),
      ),
    ).toBe("0xabc");
  });

  it.effect("focuses the matching Hyprland client with direct argv", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(
        Effect.succeed(JSON.stringify([{ address: "0xabc", class: "t3-code-alpha" }])),
      )
      .mockReturnValueOnce(Effect.succeed(""));
    const focus = make(run, () => ["t3code", "t3-code-alpha"]);

    return Effect.gen(function* () {
      yield* focus.focusForCorkdiff(ThreadId.make("thread-1"));
      expect(run).toHaveBeenNthCalledWith(1, ["-j", "clients"]);
      expect(run).toHaveBeenNthCalledWith(2, [
        "dispatch",
        'hl.dsp.focus({ window = "address:0xabc" })',
      ]);
    });
  });
});
