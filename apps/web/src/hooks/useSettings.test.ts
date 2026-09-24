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
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const persistenceMocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: persistenceMocks }),
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
  createSettingsOperationQueue,
  createSettingsOperationState,
  ensureClientSettingsHydrated,
  getClientSettings,
  mergeEnvironmentSettings,
  persistClientSettingsPatch,
  persistClientSettingsUpdate,
  persistIndependentSettingsPatches,
  resolveEnvironmentIdentificationMode,
  updateClientSettings,
} from "./useSettings";

beforeEach(() => {
  persistenceMocks.getClientSettings.mockReset().mockResolvedValue(null);
  persistenceMocks.setClientSettings.mockReset().mockResolvedValue(undefined);
  __resetClientSettingsPersistenceForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("client settings hydration", () => {
  const savedSettings = {
    ...DEFAULT_CLIENT_SETTINGS,
    timestampFormat: "12-hour" as const,
    favorites: [{ provider: ProviderInstanceId.make("codex_work"), model: "gpt-5.6" }],
  };
  const onboardingCompletedAt = "2026-09-05T12:00:00.000Z";
  const complete = (current: ClientSettings) => ({ ...current, onboardingCompletedAt });

  it("rejects completion after a failed read and preserves saved preferences on retry", async () => {
    const failure = new Error("storage unavailable");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    persistenceMocks.getClientSettings
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(savedSettings);

    await expect(persistClientSettingsUpdate(complete)).rejects.toBe(failure);
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();
    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);

    const completedSettings = { ...savedSettings, onboardingCompletedAt };
    await expect(persistClientSettingsUpdate(complete)).resolves.toEqual(completedSettings);
    expect(persistenceMocks.setClientSettings).toHaveBeenCalledExactlyOnceWith(completedSettings);
    expect(persistenceMocks.getClientSettings).toHaveBeenCalledTimes(2);
  });

  it("uses defaults only after storage confirms no saved settings exist", async () => {
    const completedSettings = { ...DEFAULT_CLIENT_SETTINGS, onboardingCompletedAt };

    await expect(persistClientSettingsUpdate(complete)).resolves.toEqual(completedSettings);
    expect(persistenceMocks.getClientSettings).toHaveBeenCalledOnce();
    expect(persistenceMocks.setClientSettings).toHaveBeenCalledExactlyOnceWith(completedSettings);
  });

  it("holds patches until a pending read supplies the saved preferences", async () => {
    let finishRead!: (settings: ClientSettings) => void;
    persistenceMocks.getClientSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const persisted = new Promise<ClientSettings>((resolve) => {
      persistenceMocks.setClientSettings.mockImplementationOnce(async (settings) => {
        resolve(settings);
      });
    });

    const hydration = ensureClientSettingsHydrated();
    persistClientSettingsPatch({ wordWrap: false });
    expect(getClientSettings()).toBe(DEFAULT_CLIENT_SETTINGS);
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();

    finishRead(savedSettings);
    await hydration;
    await expect(persisted).resolves.toEqual({ ...savedSettings, wordWrap: false });
    expect(persistenceMocks.getClientSettings).toHaveBeenCalledOnce();
  });

  it("handles failed patch reads without writing and retries with the saved preferences", async () => {
    const failure = new Error("storage unavailable");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    persistenceMocks.getClientSettings.mockRejectedValue(failure);

    const hydration = ensureClientSettingsHydrated();
    persistClientSettingsPatch({ wordWrap: false });
    await expect(hydration).rejects.toBe(failure);
    expect(persistenceMocks.setClientSettings).not.toHaveBeenCalled();

    persistenceMocks.getClientSettings.mockResolvedValue(savedSettings);
    const persisted = new Promise<ClientSettings>((resolve) => {
      persistenceMocks.setClientSettings.mockImplementationOnce(async (settings) => {
        resolve(settings);
      });
    });
    persistClientSettingsPatch({ wordWrap: false });

    await expect(persisted).resolves.toEqual({ ...savedSettings, wordWrap: false });
  });

  it("preserves patch order across hydration and a blocked completion write", async () => {
    let finishRead!: (settings: ClientSettings) => void;
    const read = new Promise<ClientSettings>((resolve) => {
      finishRead = resolve;
    });
    persistenceMocks.getClientSettings.mockReturnValue(read);
    let finishCompletionWrite!: () => void;
    const blockedWrite = new Promise<void>((resolve) => {
      finishCompletionWrite = resolve;
    });
    let signalCompletionWrite!: () => void;
    const completionWriteStarted = new Promise<void>((resolve) => {
      signalCompletionWrite = resolve;
    });
    let durableSettings: ClientSettings = savedSettings;
    const persist = vi
      .fn<(settings: ClientSettings) => Promise<void>>()
      .mockImplementationOnce(async (settings) => {
        signalCompletionWrite();
        await blockedWrite;
        durableSettings = settings;
      })
      .mockImplementation(async (settings) => {
        durableSettings = settings;
      });

    const completion = persistClientSettingsUpdate(complete, persist);
    persistClientSettingsPatch({ wordWrap: false }, persist);
    finishRead(savedSettings);
    await completionWriteStarted;
    persistClientSettingsPatch({ wordWrap: true }, persist);
    const finalWrite = persistClientSettingsUpdate((current) => current, persist);

    finishCompletionWrite();
    await completion;
    await finalWrite;

    const expected = { ...savedSettings, onboardingCompletedAt, wordWrap: true };
    expect(getClientSettings()).toEqual(expected);
    expect(durableSettings).toEqual(expected);
  });
});

describe("persistClientSettingsPatch", () => {
  it("waits for settings writes in request order", async () => {
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    let finishFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    persistenceMocks.setClientSettings.mockImplementationOnce(() => {
      markFirstStarted();
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });

    const firstSettings = { ...DEFAULT_CLIENT_SETTINGS, snapShotFlash: false };
    const secondSettings = { ...firstSettings, snapShotPlaySound: false };
    const first = persistClientSettingsPatch({ snapShotFlash: false });
    await firstStarted;
    const second = persistClientSettingsPatch({ snapShotPlaySound: false });

    expect(persistenceMocks.setClientSettings).toHaveBeenCalledTimes(1);
    expect(getClientSettings()).toEqual(secondSettings);
    finishFirst();
    await Promise.all([first, second]);

    expect(persistenceMocks.setClientSettings).toHaveBeenNthCalledWith(1, firstSettings);
    expect(persistenceMocks.setClientSettings).toHaveBeenNthCalledWith(2, secondSettings);
  });
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
    const patch = persistClientSettingsPatch({ wordWrap: false }, persist);
    finishFirstPersistence();
    await Promise.all([pending, patch]);

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

    void persistClientSettingsPatch({ wordWrap: false }, persist);
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

describe("onboarding completion persistence", () => {
  it("keeps onboarding incomplete after a failed save and preserves preferences on retry", async () => {
    const failure = new Error("disk full");
    const persist = vi
      .fn<(settings: typeof DEFAULT_CLIENT_SETTINGS) => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const existingSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      timestampFormat: "12-hour" as const,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_work"),
          model: "gpt-5.6",
        },
      ],
    };
    __setClientSettingsForTests(existingSettings);
    const onboardingCompletedAt = "2026-09-01T12:00:00.000Z";
    const complete = (current: typeof DEFAULT_CLIENT_SETTINGS) => ({
      ...current,
      onboardingCompletedAt,
    });

    await expect(persistClientSettingsUpdate(complete, persist)).rejects.toBe(failure);
    expect(getClientSettings()).toBe(existingSettings);
    expect(getClientSettings().onboardingCompletedAt).toBeNull();

    const completedSettings = { ...existingSettings, onboardingCompletedAt };
    await expect(persistClientSettingsUpdate(complete, persist)).resolves.toEqual(
      completedSettings,
    );
    expect(getClientSettings()).toEqual(completedSettings);
    expect(persist).toHaveBeenLastCalledWith(completedSettings);
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

describe("updateClientSettings", () => {
  it("composes rapid functional updates optimistically", async () => {
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
    const codex = ProviderInstanceId.make("codex");
    const toggle = (model: string) =>
      updateClientSettings((settings) => ({
        favorites: [...settings.favorites, { provider: codex, model }],
      }));

    const first = toggle("a");
    const second = toggle("b");
    expect(getClientSettings().favorites.map(({ model }) => model)).toEqual(["a", "b"]);
    await Promise.all([first, second]);
    expect(persistenceMocks.setClientSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        favorites: [
          { provider: codex, model: "a" },
          { provider: codex, model: "b" },
        ],
      }),
    );
  });

  it("resolves a functional update against saved settings when it precedes hydration", async () => {
    const codex = ProviderInstanceId.make("codex");
    persistenceMocks.getClientSettings.mockResolvedValue({
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: [{ provider: codex, model: "saved" }],
    });

    await updateClientSettings((settings) => ({
      favorites: [...settings.favorites, { provider: codex, model: "new" }],
    }));

    expect(getClientSettings().favorites.map(({ model }) => model)).toEqual(["saved", "new"]);
  });
});

describe("createSettingsOperationState", () => {
  it("treats a later outside change as authoritative after early projections", async () => {
    const state = createSettingsOperationState();
    const instance = { driver: ProviderDriverKind.make("codex"), enabled: true };
    const firstId = ProviderInstanceId.make("codex_first");
    const secondId = ProviderInstanceId.make("codex_second");
    const afterFirst = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: { [firstId]: instance },
    };
    const afterSecond = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: { [firstId]: instance, [secondId]: instance },
    };
    let projection = DEFAULT_SERVER_SETTINGS;
    const write = (response: typeof afterFirst) =>
      state.enqueue(async () => {
        state.resolveServerSettings(projection);
        await state.persistAuthoritativeServerSettings(
          async () => {
            // The projection lands before the RPC response resolves.
            projection = { ...response };
            return response;
          },
          () => projection,
        );
      });

    await write(afterFirst);
    await write(afterSecond);

    // Another client restores the first configuration.
    const restoredElsewhere = { ...afterFirst };
    expect(state.resolveServerSettings(restoredElsewhere)).toBe(restoredElsewhere);
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

// Mirrors `usePersistClientSettings`: patches merge onto the durable snapshot
// through upstream's `persistClientSettingsUpdate` queue.
function persistClientPatch(
  update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
  persist: (settings: ClientSettings) => Promise<void>,
) {
  return persistClientSettingsUpdate(
    (current) => ({ ...current, ...(typeof update === "function" ? update(current) : update) }),
    persist,
  ).then(() => undefined);
}

describe("functional client settings patches", () => {
  beforeEach(() => {
    __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  });

  it("serializes writes, merges concurrent patches, and publishes only durable snapshots", async () => {
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const persisted: ClientSettings[] = [];
    const persistPatch = (
      update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
    ) =>
      persistClientPatch(update, async (settings) => {
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
      persistClientPatch(update, async () => {
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
      persistClientPatch(update, async (settings) => {
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
      persistClientPatch(update, async (settings) => {
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
