import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it("derives Electron's native Wayland app id from its display name", () => {
    assert.equal(DesktopEnvironment.resolveLinuxWaylandAppId("T3 Code (Alpha)"), "t3-code-alpha");
    assert.equal(DesktopEnvironment.resolveLinuxWaylandAppId("T3 Code (Dev)"), "t3-code-dev");
  });

  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.t3/dev");
      assert.equal(production.stateDir, "/Users/alice/.t3/userdata");
    }),
  );

  it.effect("uses a configured Linux desktop entry name override", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        { platform: "linux" },
        { T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME: " t3-code-alpha.desktop " },
      );
      const defaultEnvironment = yield* makeEnvironment({ platform: "linux" });

      assert.equal(environment.linuxDesktopEntryName, "t3-code-alpha.desktop");
      assert.isTrue(environment.linuxDesktopEntryExternal);
      assert.equal(defaultEnvironment.linuxDesktopEntryName, "com.t3tools.T3Code.desktop");
      assert.isFalse(defaultEnvironment.linuxDesktopEntryExternal);
    }),
  );

  // The fork's T3CODE_DESKTOP_LINUX_URL_HANDLER_EXEC is upstream's T3CODE_DESKTOP_LAUNCHER_PATH.
  it.effect("uses a configured Linux URL handler executable", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        { platform: "linux" },
        { T3CODE_DESKTOP_LAUNCHER_PATH: " /nix/store/t3-code/bin/t3-code " },
      );

      assert.deepEqual(
        environment.desktopLauncherPath,
        Option.some("/nix/store/t3-code/bin/t3-code"),
      );
    }),
  );
});
