import { describe, expect, it } from "vite-plus/test";

import { resolveDesktopOzoneArgs, resolveDesktopOzoneEnv } from "./runtime-args.mjs";

describe("desktop runtime arguments", () => {
  it("adds explicit Wayland arguments and environment hints on Linux", () => {
    const env = { T3CODE_DESKTOP_OZONE_PLATFORM: "wayland" };

    expect(resolveDesktopOzoneArgs(env, "linux")).toEqual([
      "--enable-features=UseOzonePlatform",
      "--ozone-platform-hint=wayland",
      "--ozone-platform=wayland",
    ]);
    expect(resolveDesktopOzoneEnv(env, "linux")).toEqual({
      ELECTRON_OZONE_PLATFORM_HINT: "wayland",
      NIXOS_OZONE_WL: "1",
    });
  });

  it("does not emit arguments for invalid modes or non-Linux hosts", () => {
    expect(resolveDesktopOzoneArgs({ T3CODE_DESKTOP_OZONE_PLATFORM: "mir" }, "linux")).toEqual([]);
    expect(resolveDesktopOzoneArgs({ T3CODE_DESKTOP_OZONE_PLATFORM: "wayland" }, "darwin")).toEqual(
      [],
    );
  });

  it("does not force Wayland from a stale NixOS hint in an X11 session", () => {
    expect(resolveDesktopOzoneArgs({ NIXOS_OZONE_WL: "1" }, "linux")).toEqual([]);
  });

  it("uses Electron and NixOS hints only when no explicit mode is configured", () => {
    expect(resolveDesktopOzoneArgs({ ELECTRON_OZONE_PLATFORM_HINT: "x11" }, "linux")).toContain(
      "--ozone-platform=x11",
    );
    expect(
      resolveDesktopOzoneArgs({ NIXOS_OZONE_WL: "1", WAYLAND_DISPLAY: "wayland-1" }, "linux"),
    ).toContain("--ozone-platform=wayland");
  });
});
