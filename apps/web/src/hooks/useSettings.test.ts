import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  type ClientSettings,
  type ClientSettingsPatch,
  DEFAULT_CLIENT_SETTINGS,
} from "@t3tools/contracts/settings";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  __resetClientSettingsPersistenceForTests,
  createSettingsOperationState,
  createSettingsOperationQueue,
  persistIndependentSettingsPatches,
  persistClientSettingsDurablePatch,
  __setClientSettingsForTests,
  getClientSettings,
  mergeEnvironmentSettings,
  persistClientSettingsPatch,
  persistClientSettingsUpdate,
  resolveEnvironmentIdentificationMode,
} from "./useSettings";

beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
});

describe("persistClientSettingsUpdate", () => {
  it("publishes the update only after persistence succeeds", async () => {
    let finishPersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const setClientSettings = vi.fn(() => persistence);
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);

    const pending = persistClientSettingsUpdate(
      (current) => ({
        ...current,
        timestampFormat: "12-hour",
      }),
      setClientSettings,
    );

    expect(getClientSettings().timestampFormat).toBe(DEFAULT_CLIENT_SETTINGS.timestampFormat);
    finishPersistence();
    await expect(pending).resolves.toMatchObject({ timestampFormat: "12-hour" });
    expect(getClientSettings().timestampFormat).toBe("12-hour");
  });

  it("keeps the current snapshot and propagates persistence failure", async () => {
    const failure = new Error("disk full");
    const setClientSettings = vi.fn().mockRejectedValue(failure);
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);

    await expect(
      persistClientSettingsUpdate(
        (current) => ({ ...current, timestampFormat: "12-hour" }),
        setClientSettings,
      ),
    ).rejects.toBe(failure);
    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  });

  it("preserves an optimistic write made while an awaited update persists", async () => {
    let finishFirstPersistence!: () => void;
    let durableSettings = DEFAULT_CLIENT_SETTINGS;
    const firstPersistence = new Promise<void>((resolve) => {
      finishFirstPersistence = resolve;
    });
    const persist = vi
      .fn<(settings: typeof DEFAULT_CLIENT_SETTINGS) => Promise<void>>()
      .mockImplementationOnce((settings) =>
        firstPersistence.then(() => {
          durableSettings = settings;
        }),
      )
      .mockImplementation(async (settings) => {
        durableSettings = settings;
      });
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    const importedProfile = { id: "profile-import", name: "Imported", kind: "persistent" as const };

    const pending = persistClientSettingsUpdate(
      (current) => ({
        ...current,
        browserProfiles: [...current.browserProfiles, importedProfile],
      }),
      persist,
    );
    await Promise.resolve();
    persistClientSettingsPatch({ wordWrap: false }, persist);
    finishFirstPersistence();
    await pending;
    await Promise.resolve();

    expect(persist).toHaveBeenCalledTimes(3);
    expect(persist.mock.calls[1]?.[0]).toMatchObject({
      wordWrap: false,
    });
    expect(persist.mock.calls[1]?.[0].browserProfiles).toContainEqual(importedProfile);
    expect(durableSettings.wordWrap).toBe(false);
    expect(durableSettings.browserProfiles).toContainEqual(importedProfile);
    expect(getClientSettings().wordWrap).toBe(false);
    expect(getClientSettings().browserProfiles).toContainEqual(importedProfile);
  });

  it("orders an awaited update after an older optimistic write", async () => {
    let finishOldWrite!: () => void;
    let durableSettings = DEFAULT_CLIENT_SETTINGS;
    const oldWrite = new Promise<void>((resolve) => {
      finishOldWrite = resolve;
    });
    const persist = vi
      .fn<(settings: typeof DEFAULT_CLIENT_SETTINGS) => Promise<void>>()
      .mockImplementationOnce((settings) =>
        oldWrite.then(() => {
          durableSettings = settings;
        }),
      )
      .mockImplementation(async (settings) => {
        durableSettings = settings;
      });
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);

    persistClientSettingsPatch({ wordWrap: false }, persist);
    const importedProfile = { id: "profile-import", name: "Imported", kind: "persistent" as const };
    const registration = persistClientSettingsUpdate(
      (current) => ({
        ...current,
        browserProfiles: [...current.browserProfiles, importedProfile],
      }),
      persist,
    );
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);

    finishOldWrite();
    await registration;

    expect(persist).toHaveBeenCalledTimes(2);
    expect(durableSettings.wordWrap).toBe(false);
    expect(durableSettings.browserProfiles).toContainEqual(importedProfile);
  });

  it("continues the queue after a rejected write", async () => {
    const failure = new Error("disk full");
    const persist = vi
      .fn<(settings: typeof DEFAULT_CLIENT_SETTINGS) => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);

    await expect(
      persistClientSettingsUpdate(
        (current) => ({ ...current, timestampFormat: "12-hour" }),
        persist,
      ),
    ).rejects.toBe(failure);
    await expect(
      persistClientSettingsUpdate((current) => ({ ...current, wordWrap: false }), persist),
    ).resolves.toMatchObject({ wordWrap: false });
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

  it("keeps server settlement settings when legacy client data contains retired keys", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      sidebarAutoSettleAfterDays: 14,
      sidebarAutoSettleOnMerge: false,
    };
    const legacyClientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      sidebarAutoSettleAfterDays: 1,
      sidebarAutoSettleOnMerge: true,
    };

    const settings = mergeEnvironmentSettings(serverSettings, legacyClientSettings);

    expect(settings.sidebarAutoSettleAfterDays).toBe(14);
    expect(settings.sidebarAutoSettleOnMerge).toBe(false);
  });
});

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

describe("persistClientSettingsDurablePatch", () => {
  it("serializes writes, merges concurrent patches, and publishes only durable snapshots", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const persisted: ClientSettings[] = [];
    const persistPatch = (
      update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
    ) =>
      persistClientSettingsDurablePatch(update, async (settings) => {
        persisted.push(settings);
        if (persisted.length === 1) {
          await firstWriteBlocked;
        }
      });

    const first = persistPatch({ confirmThreadArchive: true });
    await Promise.resolve();
    const second = persistPatch({ diffIgnoreWhitespace: false });

    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
    expect(persisted).toHaveLength(1);

    releaseFirstWrite?.();
    await Promise.all([first, second]);

    expect(persisted).toHaveLength(2);
    expect(persisted[1]?.confirmThreadArchive).toBe(true);
    expect(persisted[1]?.diffIgnoreWhitespace).toBe(false);
    expect(getClientSettings().confirmThreadArchive).toBe(true);
    expect(getClientSettings().diffIgnoreWhitespace).toBe(false);
  });

  it("does not publish a settings patch when persistence fails", async () => {
    const persistPatch = (
      update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
    ) =>
      persistClientSettingsDurablePatch(update, async () => {
        throw new Error("disk full");
      });

    await expect(persistPatch({ defaultProjectHyprnavSettings: { bindings: [] } })).rejects.toThrow(
      "disk full",
    );
    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
  });

  it("resolves functional updates against the preceding durable settings", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const persisted: ClientSettings[] = [];
    const persistPatch = (
      update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
    ) =>
      persistClientSettingsDurablePatch(update, async (settings) => {
        persisted.push(settings);
        if (persisted.length === 1) await firstWriteBlocked;
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
    expect(getClientSettings().favorites.map(({ model }) => model)).toEqual(["a", "b"]);
  });

  it("rebases later updates onto the last durable snapshot after a failure", async () => {
    let writeCount = 0;
    const persisted: ClientSettings[] = [];
    const persistPatch = (
      update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
    ) =>
      persistClientSettingsDurablePatch(update, async (settings) => {
        writeCount += 1;
        if (writeCount === 1) throw new Error("disk full");
        persisted.push(settings);
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
    expect(getClientSettings().favorites.map(({ model }) => model)).toEqual(["durable"]);
  });
});
