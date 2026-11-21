import { describe, expect, it } from "vite-plus/test";

import {
  hyprctlCommandError,
  hyprlandCloseWindowDispatcher,
  hyprlandExecDispatcher,
  hyprlandFocusWindowDispatcher,
  hyprlandFocusWorkspaceDispatcher,
} from "./hyprland.ts";

describe("Hyprland 0.55 dispatchers", () => {
  it("builds Lua dispatchers for workspace and exact-window focus", () => {
    expect(hyprlandFocusWorkspaceDispatcher(124)).toBe("hl.dsp.focus({ workspace = 124 })");
    expect(hyprlandFocusWorkspaceDispatcher(-99)).toBe("hl.dsp.focus({ workspace = -99 })");
    expect(hyprlandFocusWindowDispatcher("0xabc123")).toBe(
      'hl.dsp.focus({ window = "address:0xabc123" })',
    );
    expect(hyprlandCloseWindowDispatcher("0xabc123")).toBe(
      'hl.dsp.window.close({ window = "address:0xabc123" })',
    );
    expect(hyprlandExecDispatcher('ghostty --title="hello"', 124)).toBe(
      'hl.dsp.exec_cmd("ghostty --title=\\\"hello\\\"", { workspace = "124 silent" })',
    );
  });

  it("rejects invalid values before interpolating Lua", () => {
    expect(() => hyprlandFocusWorkspaceDispatcher(0)).toThrow("Invalid Hyprland workspace");
    expect(() => hyprlandFocusWindowDispatcher('0xabc" })')).toThrow(
      "Invalid Hyprland window address",
    );
  });

  it("treats Hyprland 0.55 textual dispatch failures as errors despite exit code zero", () => {
    expect(
      hyprctlCommandError({
        code: 0,
        stdout: "error: ')' expected near 'address'\n",
        stderr: "",
      }),
    ).toContain("expected near");
    expect(
      hyprctlCommandError({
        code: 0,
        stdout: "warning: hl.focus: window not found\n",
        stderr: "",
      }),
    ).toContain("window not found");
    expect(hyprctlCommandError({ code: 0, stdout: "ok\n", stderr: "" })).toBeNull();
  });
});
