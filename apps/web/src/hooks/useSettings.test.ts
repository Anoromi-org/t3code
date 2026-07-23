import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import {
  createClientSettingsPatchQueue,
  createSettingsOperationState,
  createSettingsOperationQueue,
  mergeEnvironmentSettings,
  persistIndependentSettingsPatches,
  resolveEnvironmentIdentificationMode,
} from "./useSettings";

describe("createSettingsOperationQueue", () => {
  it("resolves same-environment map updates after the preceding durable write", async () => {
    const queue = createSettingsOperationQueue();
    let providerInstances: Record<string, string> = {};
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });

    const persistInstance = (id: string, block = false) =>
      queue(async () => {
        const next = { ...providerInstances, [id]: id };
        if (block) await firstWriteBlocked;
        providerInstances = next;
      });
    const first = persistInstance("codex_work", true);
    await Promise.resolve();
    const second = persistInstance("codex_personal");
    releaseFirstWrite?.();
    await Promise.all([first, second]);

    expect(providerInstances).toEqual({
      codex_work: "codex_work",
      codex_personal: "codex_personal",
    });
  });

  it("does not block settings writes for a different environment", async () => {
    const localQueue = createSettingsOperationQueue();
    const remoteQueue = createSettingsOperationQueue();
    let releaseLocal: (() => void) | undefined;
    const localBlocked = new Promise<void>((resolve) => {
      releaseLocal = resolve;
    });
    let remoteCompleted = false;

    const local = localQueue(async () => localBlocked);
    await Promise.resolve();
    await remoteQueue(async () => {
      remoteCompleted = true;
    });
    expect(remoteCompleted).toBe(true);
    releaseLocal?.();
    await local;
  });

  it("continues from durable state after an earlier server write fails", async () => {
    const queue = createSettingsOperationQueue();
    let providerInstances: Record<string, string> = {};
    const failed = queue(async () => {
      throw new Error("server unavailable");
    });
    const succeeding = queue(async () => {
      providerInstances = { ...providerInstances, codex_durable: "codex_durable" };
    });

    await expect(failed).rejects.toThrow("server unavailable");
    await expect(succeeding).resolves.toBeUndefined();
    expect(providerInstances).toEqual({ codex_durable: "codex_durable" });
  });

  it("rebases a queued map update onto the authoritative server response", async () => {
    const state = createSettingsOperationState();
    const externalId = ProviderInstanceId.make("codex_external");
    const localId = ProviderInstanceId.make("codex_local");
    const secondId = ProviderInstanceId.make("codex_second");
    const thirdId = ProviderInstanceId.make("codex_third");
    const instance = { driver: ProviderDriverKind.make("codex"), enabled: true };
    const projected = DEFAULT_SERVER_SETTINGS;
    const authoritativeAfterFirst = {
      ...projected,
      providerInstances: {
        [externalId]: instance,
        [localId]: instance,
      },
    };
    const laggingProjection = {
      ...projected,
      providerInstances: { [externalId]: instance },
    };
    let currentProjection = projected;
    let secondOutbound = projected.providerInstances;
    let authoritativeAfterSecond = projected;

    const first = state.enqueue(async () => {
      const base = state.resolveServerSettings(projected);
      const firstOutbound = { ...base.providerInstances, [localId]: instance };
      await state.persistAuthoritativeServerSettings(
        async () => {
          currentProjection = laggingProjection;
          return {
            ...authoritativeAfterFirst,
            providerInstances: {
              ...authoritativeAfterFirst.providerInstances,
              ...firstOutbound,
            },
          };
        },
        () => currentProjection,
      );
    });
    const second = state.enqueue(async () => {
      const base = state.resolveServerSettings(currentProjection);
      secondOutbound = {
        ...base.providerInstances,
        [secondId]: instance,
      };
      await state.persistAuthoritativeServerSettings(
        async () => {
          authoritativeAfterSecond = {
            ...base,
            providerInstances: secondOutbound,
          };
          return authoritativeAfterSecond;
        },
        () => currentProjection,
      );
    });

    await Promise.all([first, second]);
    expect(secondOutbound).toEqual({
      [externalId]: instance,
      [localId]: instance,
      [secondId]: instance,
    });

    currentProjection = authoritativeAfterFirst;
    let thirdOutbound = projected.providerInstances;
    await state.enqueue(async () => {
      const base = state.resolveServerSettings(currentProjection);
      thirdOutbound = { ...base.providerInstances, [thirdId]: instance };
      await state.persistAuthoritativeServerSettings(
        async () => ({ ...base, providerInstances: thirdOutbound }),
        () => currentProjection,
      );
    });
    expect(thirdOutbound).toEqual({
      [externalId]: instance,
      [localId]: instance,
      [secondId]: instance,
      [thirdId]: instance,
    });

    const genuinelyNewProjection = {
      ...authoritativeAfterSecond,
      enableProviderUpdateChecks: !authoritativeAfterSecond.enableProviderUpdateChecks,
    };
    expect(state.resolveServerSettings(genuinelyNewProjection)).toBe(genuinelyNewProjection);
  });
});

describe("resolveEnvironmentIdentificationMode", () => {
  it("keeps identification hidden until client settings hydrate", () => {
    expect(resolveEnvironmentIdentificationMode({ mode: "artwork", settingsHydrated: false })).toBe(
      "none",
    );
    expect(resolveEnvironmentIdentificationMode({ mode: "pill", settingsHydrated: true })).toBe(
      "pill",
    );
  });

  it("uses a pill instead of artwork with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("pill");
  });

  it("respects none with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "none",
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("none");
  });

  it("keeps artwork when the palette theme opts into it", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
        paletteThemeAllowsArtwork: true,
      }),
    ).toBe("artwork");
  });
});

describe("persistIndependentSettingsPatches", () => {
  it("still persists client settings when the server update fails", async () => {
    const calls: string[] = [];
    await expect(
      persistIndependentSettingsPatches({
        persistServer: async () => {
          calls.push("server");
          throw new Error("server unavailable");
        },
        persistClient: async () => {
          calls.push("client");
        },
      }),
    ).rejects.toThrow("server unavailable");
    expect(calls).toEqual(["server", "client"]);
  });

  it("starts client persistence without waiting for the server write", async () => {
    let releaseServer: (() => void) | undefined;
    const server = new Promise<void>((resolve) => {
      releaseServer = resolve;
    });
    let clientStarted = false;
    const persistence = persistIndependentSettingsPatches({
      persistServer: () => server,
      persistClient: async () => {
        clientStarted = true;
      },
    });

    await Promise.resolve();
    expect(clientStarted).toBe(true);
    releaseServer?.();
    await expect(persistence).resolves.toBeUndefined();
  });
});

describe("mergeEnvironmentSettings", () => {
  it("combines the selected environment's server settings with client preferences", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_remote")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    };
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_remote"),
          model: "gpt-5.4",
        },
      ],
    };

    const settings = mergeEnvironmentSettings(serverSettings, clientSettings);

    expect(settings.providerInstances).toBe(serverSettings.providerInstances);
    expect(settings.favorites).toBe(clientSettings.favorites);
  });
});

describe("createClientSettingsPatchQueue", () => {
  it("serializes writes, merges concurrent patches, and publishes only durable snapshots", async () => {
    let snapshot: ClientSettings = DEFAULT_CLIENT_SETTINGS;
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const persisted: ClientSettings[] = [];
    const persistPatch = createClientSettingsPatchQueue({
      read: () => snapshot,
      publish: (settings) => {
        snapshot = settings;
      },
      persist: async (settings) => {
        persisted.push(settings);
        if (persisted.length === 1) {
          await firstWriteBlocked;
        }
      },
    });

    const first = persistPatch({ confirmThreadArchive: true });
    await Promise.resolve();
    const second = persistPatch({ diffIgnoreWhitespace: false });

    expect(snapshot).toBe(DEFAULT_CLIENT_SETTINGS);
    expect(persisted).toHaveLength(1);

    releaseFirstWrite?.();
    await Promise.all([first, second]);

    expect(persisted).toHaveLength(2);
    expect(persisted[1]?.confirmThreadArchive).toBe(true);
    expect(persisted[1]?.diffIgnoreWhitespace).toBe(false);
    expect(snapshot.confirmThreadArchive).toBe(true);
    expect(snapshot.diffIgnoreWhitespace).toBe(false);
  });

  it("does not publish a settings patch when persistence fails", async () => {
    let snapshot: ClientSettings = DEFAULT_CLIENT_SETTINGS;
    const persistPatch = createClientSettingsPatchQueue({
      read: () => snapshot,
      publish: (settings) => {
        snapshot = settings;
      },
      persist: async () => {
        throw new Error("disk full");
      },
    });

    await expect(persistPatch({ defaultProjectHyprnavSettings: { bindings: [] } })).rejects.toThrow(
      "disk full",
    );
    expect(snapshot).toBe(DEFAULT_CLIENT_SETTINGS);
  });

  it("resolves functional updates against the preceding durable settings", async () => {
    let snapshot: ClientSettings = DEFAULT_CLIENT_SETTINGS;
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const persisted: ClientSettings[] = [];
    const persistPatch = createClientSettingsPatchQueue({
      read: () => snapshot,
      publish: (settings) => {
        snapshot = settings;
      },
      persist: async (settings) => {
        persisted.push(settings);
        if (persisted.length === 1) await firstWriteBlocked;
      },
    });

    const first = persistPatch((settings) => ({
      favorites: [
        ...settings.favorites,
        { provider: ProviderInstanceId.make("codex"), model: "a" },
      ],
    }));
    await Promise.resolve();
    const second = persistPatch((settings) => ({
      favorites: [
        ...settings.favorites,
        { provider: ProviderInstanceId.make("codex"), model: "b" },
      ],
    }));

    releaseFirstWrite?.();
    await Promise.all([first, second]);

    expect(persisted[1]?.favorites.map(({ model }) => model)).toEqual(["a", "b"]);
    expect(snapshot.favorites.map(({ model }) => model)).toEqual(["a", "b"]);
  });

  it("rebases later updates onto the last durable snapshot after a failure", async () => {
    let snapshot: ClientSettings = DEFAULT_CLIENT_SETTINGS;
    let writeCount = 0;
    const persisted: ClientSettings[] = [];
    const persistPatch = createClientSettingsPatchQueue({
      read: () => snapshot,
      publish: (settings) => {
        snapshot = settings;
      },
      persist: async (settings) => {
        writeCount += 1;
        if (writeCount === 1) throw new Error("disk full");
        persisted.push(settings);
      },
    });

    const failed = persistPatch((settings) => ({
      favorites: [
        ...settings.favorites,
        { provider: ProviderInstanceId.make("codex"), model: "failed" },
      ],
    }));
    const succeeding = persistPatch((settings) => ({
      favorites: [
        ...settings.favorites,
        { provider: ProviderInstanceId.make("codex"), model: "durable" },
      ],
    }));

    await expect(failed).rejects.toThrow("disk full");
    await expect(succeeding).resolves.toBeUndefined();
    expect(persisted[0]?.favorites.map(({ model }) => model)).toEqual(["durable"]);
    expect(snapshot.favorites.map(({ model }) => model)).toEqual(["durable"]);
  });
});
