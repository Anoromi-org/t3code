import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { DesktopThreadSwitcherAction } from "./ipc.ts";

describe("DesktopThreadSwitcherAction", () => {
  const decode = Schema.decodeUnknownSync(DesktopThreadSwitcherAction);

  it("accepts the complete desktop gesture lifecycle", () => {
    expect(
      ["advance-forward", "advance-backward", "commit", "cancel"].map((action) => decode(action)),
    ).toEqual(["advance-forward", "advance-backward", "commit", "cancel"]);
  });

  it("rejects unknown desktop actions", () => {
    expect(() => decode("open-settings")).toThrow();
  });
});
