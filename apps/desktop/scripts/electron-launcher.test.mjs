import { assert, describe, it } from "vite-plus/test";

import {
  makeDevelopmentLauncherScript,
  resolveElectronBinaryPath,
  resolveLinuxSandboxArgs,
  resolveMacLauncherPaths,
} from "./electron-launcher.mjs";

describe("electron development launcher", () => {
  it("uses captured values only as fallbacks for a live runner environment", () => {
    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: "/repo/node_modules/electron/Electron",
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {
        VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
        T3CODE_PORT: "16566",
        T3CODE_HOME: "/tmp/t3",
      },
    });

    assert.include(
      script,
      "if [ -z \"${VITE_DEV_SERVER_URL:-}\" ]; then export VITE_DEV_SERVER_URL='http://127.0.0.1:8526'; fi",
    );
    assert.notInclude(script, "\nexport VITE_DEV_SERVER_URL=");
    assert.include(
      script,
      "exec '/repo/node_modules/electron/Electron' --t3code-dev-root='/repo/apps/desktop' '/repo/apps/desktop/dist-electron/main.cjs' \"$@\"",
    );
  });

  it("repairs Electron before loading the package entrypoint", () => {
    const calls = [];
    const electronPath = resolveElectronBinaryPath({
      ensureRuntime: () => {
        calls.push("ensure");
      },
      createRequire: () => (specifier) => {
        calls.push(`require:${specifier}`);
        return "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
      },
      environment: {},
      moduleUrl: import.meta.url,
    });

    assert.equal(
      electronPath,
      "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
    assert.deepEqual(calls, ["ensure", "require:electron"]);
  });

  it("uses a packaged Electron override without downloading another runtime", () => {
    const calls = [];
    const electronPath = resolveElectronBinaryPath({
      ensureRuntime: () => calls.push("ensure"),
      createRequire: () => () => calls.push("require"),
      environment: { T3CODE_DESKTOP_ELECTRON_PATH: " /nix/store/electron/bin/electron " },
      moduleUrl: import.meta.url,
    });

    assert.equal(electronPath, "/nix/store/electron/bin/electron");
    assert.deepEqual(calls, []);
  });

  it("does not disable sandboxing for an explicit Electron wrapper", () => {
    const electronPath = "/nix/store/t3code-electron/bin/t3code-electron";

    assert.deepEqual(resolveLinuxSandboxArgs(electronPath, {}, "linux"), ["--no-sandbox"]);
    assert.deepEqual(
      resolveLinuxSandboxArgs(electronPath, { T3CODE_DESKTOP_ELECTRON_PATH: electronPath }),
      [],
    );
    assert.deepEqual(
      resolveLinuxSandboxArgs(electronPath, {
        T3CODE_DESKTOP_ELECTRON_PATH: electronPath,
        T3CODE_DESKTOP_DISABLE_SANDBOX: "1",
      }),
      ["--no-sandbox"],
    );
    assert.deepEqual(resolveLinuxSandboxArgs(electronPath, {}, "darwin"), []);
  });

  it("keeps the native Electron executable name inside the branded macOS bundle", () => {
    const paths = resolveMacLauncherPaths(
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app",
      "T3 Code (Dev)",
    );

    assert.equal(paths.launcherExecutableName, "T3 Code (Dev) Launcher");
    assert.equal(
      paths.launcherBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher",
    );
    assert.equal(
      paths.runtimeElectronBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/Electron",
    );

    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: paths.runtimeElectronBinaryPath,
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {},
    });
    assert.include(
      script,
      "exec '/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/Electron'",
    );
    assert.notInclude(script, "node_modules/electron");
  });
});
