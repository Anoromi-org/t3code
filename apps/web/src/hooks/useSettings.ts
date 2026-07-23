/**
 * Environment-scoped settings hooks.
 *
 * Abstracts the split between server-authoritative settings (persisted in
 * `settings.json` on the server, fetched via `server.getConfig`) and
 * client-only settings (persisted in localStorage).
 *
 * Live server settings always require an environment id. Primary-environment
 * access is intentionally named as such so environment-sensitive consumers
 * cannot silently read the wrong server's settings.
 */
import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import {
  type ClientSettingsPatch,
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  type EnvironmentIdentificationMode,
  type UnifiedSettings,
} from "@t3tools/contracts/settings";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import {
  filterSharedServerPatch,
  findSharedSettingsMismatches,
  pickSharedServerSettings,
  splitSharedServerPatch,
  supportsSharedSettingsSync,
} from "@t3tools/client-runtime/state/shared-settings";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ensureLocalApi } from "~/localApi";
import {
  getThemeDefinition,
  getThemePreviewSidebarArtwork,
  resolveThemeHalf,
  subscribeToThemePreview,
  themeAllowsSidebarArtwork,
} from "~/themePalette";
import * as Struct from "effect/Struct";
import { toastManager } from "~/components/ui/toast";
import { isHostedStaticApp } from "~/hostedPairing";
import { primaryServerSettingsAtom, serverEnvironment } from "~/state/server";
import { useEnvironments, usePrimaryEnvironment } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { useTheme } from "./useTheme";

const CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE = "[CLIENT_SETTINGS]";

type UnifiedSettingsPatch = ServerSettingsPatch & ClientSettingsPatch;

const clientSettingsListeners = new Set<() => void>();
const clientSettingsHydrationListeners = new Set<() => void>();
let clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
let clientSettingsHydrated = false;
let clientSettingsHydrationPromise: Promise<void> | null = null;
let clientSettingsHydrationGeneration = 0;
let clientSettingsPersistenceQueue: Promise<void> = Promise.resolve();

function emitClientSettingsChange() {
  for (const listener of clientSettingsListeners) {
    listener();
  }
}

function emitClientSettingsHydrationChange() {
  for (const listener of clientSettingsHydrationListeners) {
    listener();
  }
}

function getClientSettingsSnapshot(): ClientSettings {
  return clientSettingsSnapshot;
}

function replaceClientSettingsSnapshot(settings: ClientSettings): void {
  clientSettingsSnapshot = settings;
  emitClientSettingsChange();
}

function setClientSettingsHydrated(nextHydrated: boolean): void {
  if (clientSettingsHydrated === nextHydrated) {
    return;
  }
  clientSettingsHydrated = nextHydrated;
  emitClientSettingsHydrationChange();
}

function subscribeClientSettings(listener: () => void): () => void {
  clientSettingsListeners.add(listener);
  void hydrateClientSettings();
  return () => {
    clientSettingsListeners.delete(listener);
  };
}

function getClientSettingsHydratedSnapshot(): boolean {
  return clientSettingsHydrated;
}

function subscribeClientSettingsHydration(listener: () => void): () => void {
  clientSettingsHydrationListeners.add(listener);
  void hydrateClientSettings();
  return () => {
    clientSettingsHydrationListeners.delete(listener);
  };
}

async function hydrateClientSettings(): Promise<void> {
  if (clientSettingsHydrated) {
    return;
  }
  if (clientSettingsHydrationPromise) {
    return clientSettingsHydrationPromise;
  }

  const hydrationGeneration = clientSettingsHydrationGeneration;
  const nextHydration = (async () => {
    try {
      const persistedSettings = await ensureLocalApi().persistence.getClientSettings();
      if (hydrationGeneration !== clientSettingsHydrationGeneration) {
        return;
      }
      if (persistedSettings) {
        replaceClientSettingsSnapshot({ ...DEFAULT_CLIENT_SETTINGS, ...persistedSettings });
      }
    } catch (error) {
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} hydrate failed`, {
        operation: "hydrate",
        ...safeErrorLogAttributes(error),
      });
    } finally {
      if (hydrationGeneration === clientSettingsHydrationGeneration) {
        setClientSettingsHydrated(true);
      }
    }
  })();

  const hydrationPromise = nextHydration.finally(() => {
    if (clientSettingsHydrationPromise === hydrationPromise) {
      clientSettingsHydrationPromise = null;
    }
  });
  clientSettingsHydrationPromise = hydrationPromise;

  return clientSettingsHydrationPromise;
}

const defaultClientSettingsPersistence = (settings: ClientSettings): Promise<void> =>
  ensureLocalApi().persistence.setClientSettings(settings);

function enqueueClientSettingsPersistence<A>(work: () => Promise<A>): Promise<A> {
  const result = clientSettingsPersistenceQueue.then(work);
  clientSettingsPersistenceQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function persistClientSettingsPatch(
  patch: ClientSettingsPatch,
  persist: (settings: ClientSettings) => Promise<void> = defaultClientSettingsPersistence,
): void {
  replaceClientSettingsSnapshot({ ...getClientSettingsSnapshot(), ...patch });
  void enqueueClientSettingsPersistence(() => persist(getClientSettingsSnapshot())).catch(
    (error) => {
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} persist failed`, {
        operation: "persist",
        ...safeErrorLogAttributes(error),
      });
    },
  );
}

/**
 * Persists a client-settings update before publishing it to the in-memory
 * snapshot. If another settings write lands while persistence is pending, the
 * updater is reapplied to that newer snapshot and persisted again so neither
 * change is lost.
 */
export async function persistClientSettingsUpdate(
  update: (current: ClientSettings) => ClientSettings,
  persist: (settings: ClientSettings) => Promise<void> = defaultClientSettingsPersistence,
): Promise<ClientSettings> {
  return enqueueClientSettingsPersistence(async () => {
    for (;;) {
      const current = getClientSettingsSnapshot();
      const next = update(current);
      await persist(next);
      if (getClientSettingsSnapshot() === current) {
        replaceClientSettingsSnapshot(next);
        return next;
      }
    }
  });
}

// ── Key sets for routing patches ─────────────────────────────────────

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function splitPatch(patch: UnifiedSettingsPatch): {
  serverPatch: ServerSettingsPatch;
  clientPatch: ClientSettingsPatch;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as ClientSettingsPatch,
  };
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Non-hook accessor for the current merged client settings snapshot.
 * Used by non-React code paths (e.g. runtime services) that need the latest
 * settings without subscribing.
 */
export function getClientSettings(): ClientSettings {
  return getClientSettingsSnapshot();
}

/**
 * Resolves once client settings have been read from disk.
 *
 * The pre-hydration snapshot is just the schema defaults, so imperative paths
 * that open a preview must await this or they bake the built-in viewport, zoom
 * and appearance into a tab that never picks up the user's saved values.
 */
export function ensureClientSettingsHydrated(): Promise<void> {
  return hydrateClientSettings();
}

export function useClientSettingsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydratedSnapshot,
    () => false,
  );
}

function useClientSettingsValue(): ClientSettings {
  return useSyncExternalStore(
    subscribeClientSettings,
    getClientSettingsSnapshot,
    () => DEFAULT_CLIENT_SETTINGS,
  );
}

export function mergeEnvironmentSettings(
  serverSettings: ServerSettings,
  clientSettings: ClientSettings,
): UnifiedSettings {
  // Decode drops retired client keys, but older untyped persistence adapters
  // can still return them. Server-owned values must always win.
  return { ...clientSettings, ...serverSettings };
}

function useMergedSettings<T>(
  serverSettings: ServerSettings,
  selector: ((settings: UnifiedSettings) => T) | undefined,
): T {
  const clientSettings = useClientSettingsValue();

  const merged = useMemo<UnifiedSettings>(
    () => mergeEnvironmentSettings(serverSettings, clientSettings),
    [clientSettings, serverSettings],
  );

  return useMemo(() => (selector ? selector(merged) : (merged as T)), [merged, selector]);
}

export function useClientSettings<T = ClientSettings>(
  selector?: (settings: ClientSettings) => T,
): T {
  const settings = useClientSettingsValue();
  return useMemo(() => (selector ? selector(settings) : (settings as T)), [selector, settings]);
}

export function resolveEnvironmentIdentificationMode(input: {
  mode: EnvironmentIdentificationMode;
  settingsHydrated: boolean;
  paletteThemeActive?: boolean;
  paletteThemeAllowsArtwork?: boolean;
}): EnvironmentIdentificationMode {
  // Avoid briefly rendering the default artwork before a persisted pill/none choice loads.
  if (!input.settingsHydrated) return "none";
  // Artwork palettes are maintained for built-ins only. Keep an explicit
  // "none", but use the theme-aware pill for user-controlled palettes.
  return input.paletteThemeActive && !input.paletteThemeAllowsArtwork && input.mode === "artwork"
    ? "pill"
    : input.mode;
}

export function useEnvironmentIdentificationMode(): EnvironmentIdentificationMode {
  const settingsHydrated = useClientSettingsHydrated();
  const mode = useClientSettingsValue().environmentIdentificationMode;
  const { resolvedTheme, theme, themeHalves } = useTheme();
  const previewSidebarArtwork = useSyncExternalStore(
    subscribeToThemePreview,
    getThemePreviewSidebarArtwork,
    () => null,
  );
  const activeTheme = resolveThemeHalf(theme, themeHalves, resolvedTheme);
  const activeThemeDefinition = getThemeDefinition(activeTheme);
  return resolveEnvironmentIdentificationMode({
    mode,
    settingsHydrated,
    paletteThemeActive: previewSidebarArtwork !== null || activeThemeDefinition !== null,
    paletteThemeAllowsArtwork: previewSidebarArtwork ?? themeAllowsSidebarArtwork(activeTheme),
  });
}

/**
 * Whether the legacy sidebar (Settings → General → Legacy features) replaces
 * the default one.
 *
 * Held at the default sidebar until client settings hydrate: the pre-hydration
 * snapshot is just the schema defaults, so resolving against it could mount one
 * sidebar and then swap it out once persisted settings land — remounting the
 * whole tree for everyone instead of only for legacy opt-ins.
 */
export function useLegacySidebarEnabled(): boolean {
  const settingsHydrated = useClientSettingsHydrated();
  const legacySidebarEnabled = useClientSettingsValue().legacySidebarEnabled;
  return settingsHydrated && legacySidebarEnabled;
}

/** Read current settings for one environment, merged with client-local preferences. */
export function useEnvironmentSettings<T = UnifiedSettings>(
  environmentId: EnvironmentId,
  selector?: (settings: UnifiedSettings) => T,
): T {
  const serverSettings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  return useMergedSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS, selector);
}

/** Primary-only settings access for the settings UI and other explicitly global surfaces. */
export function usePrimarySettings<T = UnifiedSettings>(
  selector?: (settings: UnifiedSettings) => T,
): T {
  return useMergedSettings(useAtomValue(primaryServerSettingsAtom), selector);
}

export const PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE =
  "This setting is saved on a server, and the hosted app is not anchored to one. Change it from the desktop app or from the server's own address.";

/**
 * Whether primary-scoped server settings have a server to live on. The
 * hosted app connects to every environment as a remote, so it has no primary:
 * `usePrimarySettings` reads schema defaults there and writes have nowhere
 * to go. Desktop and server-served web always have one.
 */
export function usePrimarySettingsAvailable(): boolean {
  const primaryEnvironment = usePrimaryEnvironment();
  return primaryEnvironment !== null || !isHostedStaticApp();
}

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in atom-backed server state, then
 * persisted via RPC. Shared server keys (see `SHARED_SERVER_SETTING_KEYS`)
 * are written to every eligible sync target, not only the selected target, so
 * a user preference does not silently drift between machines. Client keys go
 * through client persistence.
 */
function useUpdateSettingsPatchTarget(environmentId: EnvironmentId | null) {
  const persistServerSettings = useAtomCommand(
    serverEnvironment.updateSettings,
    "server settings update",
  );
  const { environments } = useEnvironments();
  const updateSettings = useCallback(
    (patch: UnifiedSettingsPatch) => {
      const { serverPatch, clientPatch } = splitPatch(patch);

      if (Object.keys(serverPatch).length > 0) {
        const { sharedPatch, localPatch } = splitSharedServerPatch(serverPatch);
        // Dropping the write silently leaves the control looking saved.
        const warnUnsaved = (description = PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE) =>
          toastManager.add({
            type: "warning",
            title: "Setting not saved",
            description,
          });
        if (Object.keys(localPatch).length > 0) {
          if (environmentId) {
            void persistServerSettings({
              environmentId,
              input: { patch: localPatch },
            });
          } else {
            warnUnsaved();
          }
        }
        if (Object.keys(sharedPatch).length > 0) {
          const targets = new Set(
            environments.filter(supportsSharedSettingsSync).map((target) => target.environmentId),
          );
          if (environmentId) {
            targets.add(environmentId);
          }
          let wroteToTarget = false;
          for (const targetId of targets) {
            const target = environments.find((candidate) => candidate.environmentId === targetId);
            const targetPatch = filterSharedServerPatch(
              sharedPatch,
              target?.serverConfig?.environment.capabilities,
            );
            if (Object.keys(targetPatch).length === 0) continue;
            wroteToTarget = true;
            void persistServerSettings({
              environmentId: targetId,
              input: { patch: targetPatch },
            });
          }
          if (!wroteToTarget) {
            warnUnsaved(
              targets.size > 0 ? "Update older servers to save this setting." : undefined,
            );
          }
        }
      }
      if (Object.keys(clientPatch).length > 0) {
        persistClientSettingsPatch(clientPatch);
      }
    },
    [environmentId, environments, persistServerSettings],
  );

  return updateSettings;
}

/**
 * Shared-settings sync targets whose values differ from the primary's,
 * plus an action that writes the primary's values to all of them. Drift
 * happens when an environment was offline during an edit or was changed by
 * an older client.
 */
export function useSharedSettingsSync() {
  const primaryEnvironment = usePrimaryEnvironment();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const primaryCapabilities = primaryEnvironment?.serverConfig?.environment.capabilities;
  // Read the loaded config, not `primaryServerSettingsAtom`: that atom falls
  // back to defaults while the primary is disconnected, and "apply to all"
  // must never push defaults over real values. Same for a primary too old to
  // hold the shared keys: its decoded defaults are not a source of truth.
  const primarySettings =
    primaryEnvironment !== null && supportsSharedSettingsSync(primaryEnvironment)
      ? (primaryEnvironment.serverConfig?.settings ?? null)
      : null;
  const { environments } = useEnvironments();
  const persistServerSettings = useAtomCommand(
    serverEnvironment.updateSettings,
    "server settings update",
  );

  const mismatches = useMemo(
    () =>
      findSharedSettingsMismatches({
        primaryEnvironmentId,
        primarySettings,
        primaryCapabilities,
        environments: environments.map((environment) => ({
          environmentId: environment.environmentId,
          label: environment.label,
          syncEligible: supportsSharedSettingsSync(environment),
          settings: environment.serverConfig?.settings ?? null,
          capabilities: environment.serverConfig?.environment.capabilities,
        })),
      }),
    [environments, primaryEnvironmentId, primarySettings, primaryCapabilities],
  );

  const applyToAll = useCallback(() => {
    if (primarySettings === null) {
      return;
    }
    const patch = pickSharedServerSettings(primarySettings, primaryCapabilities);
    for (const mismatch of mismatches) {
      const target = environments.find(
        (candidate) => candidate.environmentId === mismatch.environmentId,
      );
      void persistServerSettings({
        environmentId: mismatch.environmentId,
        input: {
          patch: filterSharedServerPatch(patch, target?.serverConfig?.environment.capabilities),
        },
      });
    }
  }, [environments, mismatches, persistServerSettings, primarySettings, primaryCapabilities]);

  return { mismatches, applyToAll };
}

type UnifiedSettingsUpdate =
  | UnifiedSettingsPatch
  | ((settings: UnifiedSettings) => UnifiedSettingsPatch);

export type SettingsOperationQueue = <A>(operation: () => Promise<A>) => Promise<A>;

export function createSettingsOperationQueue(): SettingsOperationQueue {
  let tail = Promise.resolve();
  return <A>(operation: () => Promise<A>) => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export interface SettingsOperationState {
  readonly enqueue: SettingsOperationQueue;
  readonly resolveServerSettings: (projected: ServerSettings) => ServerSettings;
  readonly persistAuthoritativeServerSettings: (
    persist: () => Promise<ServerSettings>,
    projectedAtCompletion: () => ServerSettings,
  ) => Promise<ServerSettings>;
}

function settingsValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => settingsValuesEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) && settingsValuesEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

export function createSettingsOperationState(): SettingsOperationState {
  let lastProjectedServerSettings: ServerSettings | null = null;
  let durableServerSettings: ServerSettings | null = null;
  let pendingAuthoritativeSettings: ServerSettings[] = [];
  return {
    enqueue: createSettingsOperationQueue(),
    resolveServerSettings(projected) {
      if (projected !== lastProjectedServerSettings) {
        lastProjectedServerSettings = projected;
        const acknowledgedIndex = pendingAuthoritativeSettings.findLastIndex((authoritative) =>
          settingsValuesEqual(authoritative, projected),
        );
        if (
          acknowledgedIndex >= 0 &&
          acknowledgedIndex === pendingAuthoritativeSettings.length - 1
        ) {
          durableServerSettings = projected;
          pendingAuthoritativeSettings = [];
        } else if (acknowledgedIndex < 0) {
          durableServerSettings = projected;
          pendingAuthoritativeSettings = [];
        }
      }
      return durableServerSettings ?? projected;
    },
    async persistAuthoritativeServerSettings(persist, projectedAtCompletion) {
      const authoritative = await persist();
      durableServerSettings = authoritative;
      pendingAuthoritativeSettings.push(authoritative);
      lastProjectedServerSettings = projectedAtCompletion();
      return authoritative;
    },
  };
}

const settingsOperationQueuesByRegistry = new WeakMap<
  object,
  Map<string, SettingsOperationState>
>();

function settingsOperationQueueFor(registry: object, environmentId: EnvironmentId | null) {
  let queues = settingsOperationQueuesByRegistry.get(registry);
  if (!queues) {
    queues = new Map();
    settingsOperationQueuesByRegistry.set(registry, queues);
  }
  const key = environmentId ?? "primary";
  let state = queues.get(key);
  if (!state) {
    state = createSettingsOperationState();
    queues.set(key, state);
  }
  return state;
}

export async function persistIndependentSettingsPatches(input: {
  readonly persistServer?: () => Promise<void>;
  readonly persistClient?: () => Promise<void>;
}): Promise<void> {
  const operations = [input.persistServer, input.persistClient]
    .filter((persist): persist is () => Promise<void> => persist !== undefined)
    .map((persist) => Promise.resolve().then(persist));
  const results = await Promise.allSettled(operations);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) throw failures[0];
}

function usePersistSettingsTarget(environmentId: EnvironmentId | null) {
  const registry = useContext(RegistryContext);
  const operationState = useMemo(
    () => settingsOperationQueueFor(registry, environmentId),
    [environmentId, registry],
  );
  const persistServerSettings = useAtomCommand(
    serverEnvironment.updateSettings,
    "server settings update",
  );
  const { environments } = useEnvironments();
  const getProjectedServerSettings = useCallback(
    () =>
      registry.get(
        environmentId === null
          ? primaryServerSettingsAtom
          : serverEnvironment.settingsValueAtom(environmentId),
      ) ?? DEFAULT_SERVER_SETTINGS,
    [environmentId, registry],
  );
  return useCallback(
    (update: UnifiedSettingsUpdate): Promise<void> =>
      operationState.enqueue(async () => {
        const serverSettings = operationState.resolveServerSettings(getProjectedServerSettings());
        const resolvePatch = (clientSettings: ClientSettings) =>
          typeof update === "function"
            ? update(mergeEnvironmentSettings(serverSettings, clientSettings))
            : update;
        const patch = resolvePatch(getClientSettingsSnapshot());
        const { serverPatch, clientPatch } = splitPatch(patch);

        await persistIndependentSettingsPatches({
          ...(Object.keys(serverPatch).length > 0
            ? {
                persistServer: async () => {
                  const { sharedPatch, localPatch } = splitSharedServerPatch(serverPatch);
                  if (Object.keys(localPatch).length > 0 && !environmentId) {
                    throw new Error(PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE);
                  }
                  const targets = new Map<EnvironmentId, ServerSettingsPatch>();
                  if (Object.keys(sharedPatch).length > 0) {
                    for (const target of environments) {
                      if (
                        !supportsSharedSettingsSync(target) &&
                        target.environmentId !== environmentId
                      )
                        continue;
                      const patch = filterSharedServerPatch(
                        sharedPatch,
                        target.serverConfig?.environment.capabilities,
                      );
                      if (Object.keys(patch).length > 0) targets.set(target.environmentId, patch);
                    }
                  }
                  if (environmentId && Object.keys(localPatch).length > 0) {
                    targets.set(environmentId, { ...targets.get(environmentId), ...localPatch });
                  }
                  if (targets.size === 0) throw new Error(PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE);
                  const results = await Promise.allSettled(
                    [...targets].map(async ([targetId, patch]) => {
                      const persist = async () => {
                        const result = await persistServerSettings({
                          environmentId: targetId,
                          input: { patch },
                        });
                        if (result._tag !== "Failure") return result.value;
                        if (isAtomCommandInterrupted(result))
                          throw new Error("The settings update was interrupted.");
                        const error = squashAtomCommandFailure(result);
                        throw error instanceof Error
                          ? error
                          : new Error("Could not persist settings.");
                      };
                      if (targetId === environmentId)
                        await operationState.persistAuthoritativeServerSettings(
                          persist,
                          getProjectedServerSettings,
                        );
                      else await persist();
                    }),
                  );
                  for (const result of results)
                    if (result.status === "rejected") throw result.reason;
                },
              }
            : {}),
          ...(Object.keys(clientPatch).length > 0
            ? {
                persistClient: () =>
                  typeof update === "function"
                    ? persistClientSettingsDurablePatch(
                        (clientSettings) => splitPatch(resolvePatch(clientSettings)).clientPatch,
                      )
                    : persistClientSettingsDurablePatch(clientPatch),
              }
            : {}),
        });
      }),
    [
      environmentId,
      environments,
      getProjectedServerSettings,
      operationState,
      persistServerSettings,
    ],
  );
}

function useUpdateSettingsTarget(environmentId: EnvironmentId | null) {
  const persistSettings = usePersistSettingsTarget(environmentId);
  const updatePatch = useUpdateSettingsPatchTarget(environmentId);
  return useCallback(
    (update: UnifiedSettingsUpdate) => {
      if (typeof update === "function") void persistSettings(update).catch(() => undefined);
      else updatePatch(update);
    },
    [persistSettings, updatePatch],
  );
}

export function persistClientSettingsDurablePatch(
  update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
  persist: (settings: ClientSettings) => Promise<void> = defaultClientSettingsPersistence,
): Promise<void> {
  return persistClientSettingsUpdate(
    (current) => ({ ...current, ...(typeof update === "function" ? update(current) : update) }),
    persist,
  ).then(() => undefined);
}

export function usePersistClientSettings() {
  return useCallback(persistClientSettingsDurablePatch, []);
}
export function usePersistEnvironmentSettings(environmentId: EnvironmentId) {
  return usePersistSettingsTarget(environmentId);
}
export function usePersistPrimarySettings() {
  return usePersistSettingsTarget(usePrimaryEnvironment()?.environmentId ?? null);
}

export function useUpdateEnvironmentSettings(environmentId: EnvironmentId) {
  return useUpdateSettingsTarget(environmentId);
}

export function useUpdatePrimarySettings() {
  return useUpdateSettingsTarget(usePrimaryEnvironment()?.environmentId ?? null);
}

export function useUpdateClientSettings() {
  return useCallback(
    (update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch)) => {
      if (typeof update === "function")
        void persistClientSettingsDurablePatch(update).catch(() => undefined);
      else persistClientSettingsPatch(update);
    },
    [],
  );
}

export function __resetClientSettingsPersistenceForTests(): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
  clientSettingsHydrated = false;
  clientSettingsHydrationPromise = null;
  clientSettingsPersistenceQueue = Promise.resolve();
  clientSettingsListeners.clear();
  clientSettingsHydrationListeners.clear();
}

export function __setClientSettingsForTests(settings: ClientSettings): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = settings;
  clientSettingsHydrated = true;
  clientSettingsHydrationPromise = null;
}
