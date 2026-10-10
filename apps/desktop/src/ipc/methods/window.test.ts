import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

import type * as Electron from "electron";
import type {
  DesktopHyprnavBrowserTabRegistration,
  DesktopHyprnavBrowserTabsSyncInput,
  DesktopHyprnavSyncInput,
} from "@t3tools/contracts";

const { focusedWebContents, ownerWindow } = vi.hoisted(() => ({
  focusedWebContents: vi.fn(),
  ownerWindow: vi.fn(),
}));
vi.mock("electron", () => ({
  webContents: { getFocusedWebContents: focusedWebContents },
  BrowserWindow: { fromWebContents: ownerWindow },
}));

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as HyprnavEnvironment from "../../hyprnav/HyprnavEnvironment.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import type { DesktopSettings } from "../../settings/DesktopAppSettings.ts";
import {
  getLocalEnvironmentBootstraps,
  getWindowFullscreenState,
  pasteAsText,
  pickProjectFavicon,
  probeRemoteEditors,
  registerHyprnavBrowserTab,
  syncHyprnavBrowserTabs,
  syncHyprnavEnvironment,
} from "./window.ts";

const readyWslConfig: DesktopBackendManager.DesktopBackendStartConfig = {
  executablePath: "wsl.exe",
  args: ["-d", "Ubuntu", "--", "node", "/app/bin.mjs"],
  entryPath: "/app/bin.mjs",
  cwd: "/app",
  env: {},
  extendEnv: false,
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3774,
    host: "0.0.0.0",
    desktopBootstrapToken: "bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  bootstrapDelivery: "stdin",
  httpBaseUrl: new URL("http://127.0.0.1:3774"),
  captureOutput: true,
  preflightFailure: Option.none(),
  runningDistro: "Ubuntu",
};

const defaultWslInstance: DesktopBackendManager.DesktopBackendInstance = {
  id: DesktopBackendManager.BackendInstanceId("wsl:default"),
  label: Effect.succeed("WSL (default distro)"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeed(Option.some(readyWslConfig)),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.some(123),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
};

describe("getLocalEnvironmentBootstraps", () => {
  it.effect("publishes the concrete running distro without replacing the stable instance id", () =>
    Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();

      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (Ubuntu)",
          runningDistro: "Ubuntu",
          httpBaseUrl: "http://127.0.0.1:3774/",
          wsBaseUrl: "ws://127.0.0.1:3774/",
          bootstrapToken: "bootstrap-token",
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([defaultWslInstance]))),
  );

  it.effect("publishes a pending bootstrap only while a transient retry is scheduled", () => {
    const retryingConfig: DesktopBackendManager.DesktopBackendStartConfig = {
      ...readyWslConfig,
      preflightFailure: Option.some({
        reason: "WSL probe timed out",
        fatal: false,
        retryLimit: 12,
      }),
    };
    const retryingInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeed(Option.some(retryingConfig)),
      snapshot: Effect.succeed({
        desiredRunning: true,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 2,
        restartScheduled: true,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (default distro)",
          runningDistro: null,
          httpBaseUrl: null,
          wsBaseUrl: null,
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([retryingInstance])));
  });

  it.effect("omits a bounded transient bootstrap after retries stop", () => {
    const stoppedInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeed(
        Option.some({
          ...readyWslConfig,
          preflightFailure: Option.some({
            reason: "WSL probe timed out",
            fatal: false,
            retryLimit: 12,
          }),
        }),
      ),
      snapshot: Effect.succeed({
        desiredRunning: false,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 12,
        restartScheduled: false,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, []);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([stoppedInstance])));
  });
});

describe("getWindowFullscreenState", () => {
  it.effect("reads the current native window state", () => {
    const window = { isFullScreen: () => true } as Electron.BrowserWindow;

    return Effect.gen(function* () {
      assert.isTrue(yield* getWindowFullscreenState.handler());
    }).pipe(
      Effect.provide(
        Layer.mock(ElectronWindow.ElectronWindow)({
          currentMainOrFirst: Effect.succeed(Option.some(window)),
        }),
      ),
    );
  });
});

describe("pasteAsText", () => {
  it.effect(
    "pastes into the focused guest only after the main renderer acknowledges the menu action",
    () => {
      const paste = vi.fn();
      const mainPaste = vi.fn();
      const window = {
        webContents: { id: 42, paste: mainPaste },
        isDestroyed: () => false,
      } as unknown as Electron.BrowserWindow;
      focusedWebContents.mockReturnValue({ paste, isDestroyed: () => false });
      ownerWindow.mockReturnValue(window);

      return Effect.gen(function* () {
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        assert.equal(mainPaste.mock.calls.length, 0);

        yield* pasteAsText.handler(undefined, { sender: { id: 99 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue({}); // A focused PiP/other BrowserWindow.
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue(null); // Detached contents.
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue(window);
        focusedWebContents.mockReturnValue({ paste, isDestroyed: () => true });
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        focusedWebContents.mockReturnValue(null);
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
      }).pipe(
        Effect.provide(
          Layer.mock(ElectronWindow.ElectronWindow)({
            main: Effect.succeed(Option.some(window)),
          }),
        ),
      );
    },
  );
});

describe("pickProjectFavicon", () => {
  const pickerLayer = (pickFiles: () => Effect.Effect<Array<string>>, settings?: DesktopSettings) =>
    Layer.mergeAll(
      Layer.mock(ElectronDialog.ElectronDialog)({ pickFiles }),
      Layer.mock(ElectronWindow.ElectronWindow)({
        focusedMainOrFirst: Effect.succeed(Option.none()),
      }),
      DesktopAppSettings.layerTest(settings),
    );

  it.effect("opens a single-image picker from the project directory", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon
        .handler("/project")
        .pipe(Effect.provide(pickerLayer(pickFiles)));

      assert.strictEqual(result, "/pictures/icon.png");
      assert.deepEqual(pickFiles.mock.calls, [
        [
          {
            owner: Option.none(),
            defaultPath: Option.some("/project"),
            multiple: false,
            filters: [
              {
                name: "Images",
                extensions: ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"],
              },
            ],
          },
        ],
      ]);
    }),
  );

  it.effect("does not open a picker while the local environment is off", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon.handler("/project").pipe(
        Effect.provide(
          pickerLayer(pickFiles, {
            ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
            localEnvironmentEnabled: false,
          }),
        ),
      );

      assert.strictEqual(result, null);
      assert.strictEqual(pickFiles.mock.calls.length, 0);
    }),
  );
});

it.effect.skipIf(HostProcessPlatform.defaultValue() === "win32")(
  "finds remote editors installed without PATH launchers",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-remote-editors-" });
      for (const app of ["Cursor", "Visual Studio Code", "WebStorm"]) {
        const executable = path.join(
          home,
          "Applications",
          `${app}.app`,
          app === "WebStorm" ? "Contents/MacOS/webstorm" : "Contents/Resources/app/bin/code",
        );
        yield* fs.makeDirectory(path.dirname(executable), { recursive: true });
        yield* fs.writeFileString(executable, "#!/bin/sh\n");
        yield* fs.chmod(executable, 0o755);
      }
      const editors = yield* probeRemoteEditors.handler(undefined).pipe(
        Effect.provideService(HostProcessEnvironment, {
          HOME: home,
          PATH: path.join(home, "empty"),
        }),
        Effect.provideService(HostProcessPlatform, "darwin"),
      );
      assert.include(editors, "cursor");
      assert.include(editors, "vscode");
      assert.notInclude(editors, "webstorm");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

describe("syncHyprnavEnvironment", () => {
  it.effect("forwards project and worktree titles to the hyprnav environment", () => {
    const received: Array<DesktopHyprnavSyncInput> = [];
    return Effect.gen(function* () {
      yield* syncHyprnavEnvironment.handler({
        projectRoot: "/repo",
        worktreePath: "/repo/wt",
        threadId: "thread-1",
        threadTitle: "Thread",
        projectTitle: "Repo",
        worktreeTitle: "feature/a",
        hyprnav: { bindings: [] },
        lock: false,
      });

      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0]?.projectTitle, "Repo");
      assert.strictEqual(received[0]?.worktreeTitle, "feature/a");
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HyprnavEnvironment.HyprnavEnvironment,
          HyprnavEnvironment.HyprnavEnvironment.of({
            sync: (input) => {
              received.push(input);
              return Effect.succeed({ status: "ok", message: null, appliedScopes: ["thread"] });
            },
            lock: () => Effect.succeed({ status: "ok", message: null }),
            syncBrowserTabs: () =>
              Effect.succeed({ status: "ok", message: null, appliedThreadIds: [] }),
            registerBrowserTab: () => Effect.succeed({ status: "ok", message: null }),
          }),
        ),
      ),
    );
  });

  it.effect("preserves applied scopes through IPC result encoding", () =>
    Effect.gen(function* () {
      const result = yield* syncHyprnavEnvironment.handler({
        projectRoot: "/repo",
        worktreePath: "/repo/removed-worktree",
        hyprnav: { bindings: [] },
        lock: true,
      });

      assert.deepEqual(result, {
        status: "ok",
        message: null,
        appliedScopes: ["project"],
      });
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HyprnavEnvironment.HyprnavEnvironment,
          HyprnavEnvironment.HyprnavEnvironment.of({
            sync: () =>
              Effect.succeed({
                status: "ok",
                message: null,
                appliedScopes: ["project"],
              }),
            lock: () => Effect.succeed({ status: "ok", message: null }),
            syncBrowserTabs: () =>
              Effect.succeed({ status: "ok", message: null, appliedThreadIds: [] }),
            registerBrowserTab: () => Effect.succeed({ status: "ok", message: null }),
          }),
        ),
      ),
    ),
  );
});

describe("hyprnav browser slots IPC", () => {
  const recordingHyprnav = () => {
    const calls = {
      sync: [] as DesktopHyprnavSyncInput[],
      syncBrowserTabs: [] as DesktopHyprnavBrowserTabsSyncInput[],
      registerBrowserTab: [] as DesktopHyprnavBrowserTabRegistration[],
    };
    const layer = Layer.succeed(
      HyprnavEnvironment.HyprnavEnvironment,
      HyprnavEnvironment.HyprnavEnvironment.of({
        sync: (input) => {
          calls.sync.push(input);
          return Effect.succeed({ status: "ok", message: null, appliedScopes: ["thread"] });
        },
        lock: () => Effect.succeed({ status: "ok", message: null }),
        syncBrowserTabs: (input) => {
          calls.syncBrowserTabs.push(input);
          return Effect.succeed({
            status: "ok",
            message: null,
            appliedThreadIds: input.threads.map((thread) => thread.threadId),
          });
        },
        registerBrowserTab: (input) => {
          calls.registerBrowserTab.push(input);
          return Effect.succeed({ status: "ok", message: null });
        },
      }),
    );
    return { calls, layer };
  };

  const browserTab = {
    slot: 7,
    workspaceId: 12,
    browser: "firefox",
    tabName: "Preview",
    value: "feature/a",
  } as const;

  it.effect("decodes browser tabs on the thread sync and forwards them", () => {
    const { calls, layer } = recordingHyprnav();
    return Effect.gen(function* () {
      yield* syncHyprnavEnvironment.handler({
        projectRoot: "/repo",
        worktreePath: "/repo/wt",
        threadId: "thread-1",
        hyprnav: { bindings: [] },
        browserTabs: [browserTab],
        clearBrowserTabs: [3],
        lock: false,
      });
      assert.deepEqual(calls.sync[0]?.browserTabs, [browserTab]);
      assert.deepEqual(calls.sync[0]?.clearBrowserTabs, [3]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects a browser tab without a usable slot", () => {
    const { calls, layer } = recordingHyprnav();
    return Effect.gen(function* () {
      const result = yield* Effect.exit(
        syncHyprnavEnvironment.handler({
          projectRoot: "/repo",
          hyprnav: { bindings: [] },
          browserTabs: [{ ...browserTab, slot: 0 }],
          lock: false,
        }),
      );
      assert.isTrue(result._tag === "Failure");
      assert.strictEqual(calls.sync.length, 0);
    }).pipe(Effect.provide(layer));
  });

  it.effect("applies browser tabs to a batch of threads", () => {
    const { calls, layer } = recordingHyprnav();
    return Effect.gen(function* () {
      const result = yield* syncHyprnavBrowserTabs.handler({
        threads: [
          {
            projectRoot: "/repo",
            worktreePath: "/repo/wt",
            threadId: "thread-1",
            threadTitle: "Thread",
            projectTitle: "Repo",
            worktreeTitle: "feature/a",
            browserTabs: [browserTab],
            clearBrowserTabs: [],
            bindingSlots: [1, 2],
          },
        ],
      });
      assert.deepEqual(result, { status: "ok", message: null, appliedThreadIds: ["thread-1"] });
      assert.strictEqual(calls.syncBrowserTabs[0]?.threads[0]?.worktreeTitle, "feature/a");
      assert.deepEqual(calls.syncBrowserTabs[0]?.threads[0]?.bindingSlots, [1, 2]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("registers the browser tab a slot drives", () => {
    const { calls, layer } = recordingHyprnav();
    return Effect.gen(function* () {
      const registration = {
        browser: "firefox",
        tabName: "Preview",
        url: "https://example.test/review",
        param: "branch",
      } as const;
      yield* registerHyprnavBrowserTab.handler(registration);
      assert.deepEqual(calls.registerBrowserTab, [registration]);
    }).pipe(Effect.provide(layer));
  });
});
