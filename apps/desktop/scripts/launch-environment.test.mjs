import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  parseNullDelimitedLaunchEnvironment,
  projectCapturedLaunchEnvironment,
  resolveElectronRuntimeEnvironment,
  T3CODE_LOCAL_LAUNCH_ENV_FILE,
} from "./launch-environment.mjs";

const REQUIRED_ENV = {
  HOME: "/home/user",
  PATH: "/home/user/bin:/usr/bin",
  SHELL: "/bin/bash",
};

function snapshot(environment) {
  return Buffer.from(
    `${Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join("\0")}\0`,
  );
}

describe("local desktop launch environment", () => {
  it("parses exact values including empty, multiline, and equals characters", () => {
    expect(
      parseNullDelimitedLaunchEnvironment(
        snapshot({ ...REQUIRED_ENV, EMPTY: "", COMPLEX: "first=second\nthird" }),
      ),
    ).toEqual({ ...REQUIRED_ENV, EMPTY: "", COMPLEX: "first=second\nthird" });
  });

  it.each([
    ["not NUL terminated", Buffer.from("HOME=/tmp")],
    ["empty entry", Buffer.from("HOME=/tmp\0\0PATH=/bin\0SHELL=/bin/bash\0")],
    ["malformed entry", Buffer.from("HOME=/tmp\0PATH\0SHELL=/bin/bash\0")],
    ["duplicate key", Buffer.from("HOME=/tmp\0PATH=/bin\0SHELL=/bin/bash\0HOME=/other\0")],
    ["missing required value", snapshot({ ...REQUIRED_ENV, SHELL: "" })],
  ])("rejects %s", (_label, contents) => {
    expect(() => parseNullDelimitedLaunchEnvironment(contents)).toThrow();
  });

  it("preserves exported shell-function keys instead of rejecting a valid process environment", () => {
    expect(
      parseNullDelimitedLaunchEnvironment(
        snapshot({ ...REQUIRED_ENV, "BASH_FUNC_example%%": "() { echo example;\n}" }),
      ),
    ).toMatchObject({ "BASH_FUNC_example%%": "() { echo example;\n}" });
  });

  it("uses the captured user environment without leaking the inner Nix shell", () => {
    const projected = projectCapturedLaunchEnvironment(
      { ...REQUIRED_ENV, USER_MARKER: "captured" },
      {
        HOME: "/build-home",
        PATH: "/nix/store/bin",
        SHELL: "/nix/store/bash/bin/bash",
        NIX_BUILD_TOP: "/tmp/nix-build",
        IN_NIX_SHELL: "impure",
        name: "nix-shell-env",
        PS1: "\\[broken\\]",
        OPENSSL_DIR: "/nix/store/openssl",
        PKG_CONFIG_PATH: "/nix/store/pkgconfig",
        T3CODE_DESKTOP_ELECTRON_PATH: "/nix/store/electron",
        T3CODE_DESKTOP_OZONE_PLATFORM: "wayland",
        T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME: "t3-code-alpha.desktop",
      },
    );

    expect(projected).toEqual({
      ...REQUIRED_ENV,
      USER_MARKER: "captured",
      T3CODE_DESKTOP_OZONE_PLATFORM: "wayland",
      T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME: "t3-code-alpha.desktop",
    });
  });

  it("preserves ordinary launches when no snapshot is requested", async () => {
    const current = { ...REQUIRED_ENV, NIX_BUILD_TOP: "/intentional", CUSTOM: "value" };
    await expect(resolveElectronRuntimeEnvironment(current)).resolves.toEqual(current);
  });

  it("reads and deletes a private snapshot before returning the runtime environment", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-launch-env-"));
    const filePath = NodePath.join(directory, "environment");
    try {
      await NodeFSP.writeFile(filePath, snapshot({ ...REQUIRED_ENV, USER_MARKER: "captured" }), {
        mode: 0o600,
      });
      expect((await NodeFSP.stat(filePath)).mode & 0o777).toBe(0o600);

      await expect(
        resolveElectronRuntimeEnvironment({
          ...REQUIRED_ENV,
          SHELL: "/nix/store/bash",
          NIX_BUILD_TOP: "/tmp/nix-build",
          [T3CODE_LOCAL_LAUNCH_ENV_FILE]: filePath,
        }),
      ).resolves.toEqual({ ...REQUIRED_ENV, USER_MARKER: "captured" });
      await expect(NodeFSP.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed and still deletes malformed snapshots", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-launch-env-"));
    const filePath = NodePath.join(directory, "environment");
    try {
      await NodeFSP.writeFile(filePath, "malformed");
      await expect(
        resolveElectronRuntimeEnvironment({
          ...REQUIRED_ENV,
          [T3CODE_LOCAL_LAUNCH_ENV_FILE]: filePath,
        }),
      ).rejects.toThrow("Unable to restore the pre-Nix launch environment");
      await expect(NodeFSP.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("fails when cleanup cannot be completed", async () => {
    const fileSystem = {
      readFile: async () => snapshot(REQUIRED_ENV),
      unlink: async () => {
        throw new Error("permission denied");
      },
    };
    await expect(
      resolveElectronRuntimeEnvironment(
        { ...REQUIRED_ENV, [T3CODE_LOCAL_LAUNCH_ENV_FILE]: "/tmp/environment" },
        fileSystem,
      ),
    ).rejects.toThrow("Unable to restore the pre-Nix launch environment");
  });
});
