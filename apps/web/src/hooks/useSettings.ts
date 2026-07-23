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
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ensureLocalApi } from "~/localApi";
import {
  getThemeDefinition,
  getThemePreviewSidebarArtwork,
  resolveThemeHalf,
  subscribeToThemePreview,
} from "~/themePalette";
import * as Struct from "effect/Struct";
import { primaryServerSettingsAtom, serverEnvironment } from "~/state/server";
import { usePrimaryEnvironment } from "~/state/environments";
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

export function createClientSettingsPatchQueue(input: {
  readonly read: () => ClientSettings;
  readonly publish: (settings: ClientSettings) => void;
  readonly persist: (settings: ClientSettings) => Promise<void>;
  readonly onPersistenceError?: (error: unknown) => void;
}): (
  update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
) => Promise<void> {
  let persistenceTail = Promise.resolve();

  return (update) => {
    const operation = persistenceTail.then(async () => {
      const currentSettings = input.read();
      const patch = typeof update === "function" ? update(currentSettings) : update;
      const settings = { ...currentSettings, ...patch };
      await input.persist(settings);
      input.publish(settings);
    });
    persistenceTail = operation.catch((error: unknown) => {
      input.onPersistenceError?.(error);
    });
    return operation;
  };
}

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

function createClientSettingsPersistenceQueue() {
  return createClientSettingsPatchQueue({
    read: getClientSettingsSnapshot,
    publish: replaceClientSettingsSnapshot,
    persist: (settings) => ensureLocalApi().persistence.setClientSettings(settings),
    onPersistenceError: (error) => {
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} persist failed`, {
        operation: "persist",
        ...safeErrorLogAttributes(error),
      });
    },
  });
}

let persistClientSettingsPatch = createClientSettingsPersistenceQueue();

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
  return { ...serverSettings, ...clientSettings };
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
  // Stage artwork has fixed colors that can clash with palette themes. Keep an
  // explicit "none", but use the theme-aware pill in place of artwork.
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
    paletteThemeAllowsArtwork:
      previewSidebarArtwork ?? activeThemeDefinition?.sidebarArtwork === true,
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

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in atom-backed server state, then
 * persisted via RPC. Client keys go through client persistence.
 */
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
                  if (!environmentId) {
                    throw new Error("The primary environment is unavailable.");
                  }
                  await operationState.persistAuthoritativeServerSettings(async () => {
                    const result = await persistServerSettings({
                      environmentId,
                      input: { patch: serverPatch },
                    });
                    if (result._tag !== "Failure") return result.value;
                    if (isAtomCommandInterrupted(result)) {
                      throw new Error("The settings update was interrupted.");
                    }
                    const error = squashAtomCommandFailure(result);
                    throw error instanceof Error ? error : new Error("Could not persist settings.");
                  }, getProjectedServerSettings);
                },
              }
            : {}),
          ...(Object.keys(clientPatch).length > 0
            ? {
                persistClient: () =>
                  typeof update === "function"
                    ? persistClientSettingsPatch(
                        (clientSettings) => splitPatch(resolvePatch(clientSettings)).clientPatch,
                      )
                    : persistClientSettingsPatch(clientPatch),
              }
            : {}),
        });
      }),
    [environmentId, getProjectedServerSettings, operationState, persistServerSettings],
  );
}

function useUpdateSettingsTarget(environmentId: EnvironmentId | null) {
  const persistSettings = usePersistSettingsTarget(environmentId);
  return useCallback(
    (update: UnifiedSettingsUpdate) => {
      void persistSettings(update).catch(() => undefined);
    },
    [persistSettings],
  );
}

export function useUpdateEnvironmentSettings(environmentId: EnvironmentId) {
  return useUpdateSettingsTarget(environmentId);
}

export function useUpdatePrimarySettings() {
  return useUpdateSettingsTarget(usePrimaryEnvironment()?.environmentId ?? null);
}

export function usePersistEnvironmentSettings(environmentId: EnvironmentId) {
  return usePersistSettingsTarget(environmentId);
}

export function usePersistPrimarySettings() {
  return usePersistSettingsTarget(usePrimaryEnvironment()?.environmentId ?? null);
}

export function useUpdateClientSettings() {
  return useCallback(
    (update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch)) => {
      void persistClientSettingsPatch(update).catch(() => undefined);
    },
    [],
  );
}

/** Persist a client settings patch and wait until every earlier client write has settled. */
export function usePersistClientSettings() {
  return useCallback(
    (
      update: ClientSettingsPatch | ((settings: ClientSettings) => ClientSettingsPatch),
    ): Promise<void> => persistClientSettingsPatch(update),
    [],
  );
}

export function __resetClientSettingsPersistenceForTests(): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
  clientSettingsHydrated = false;
  clientSettingsHydrationPromise = null;
  clientSettingsListeners.clear();
  clientSettingsHydrationListeners.clear();
  persistClientSettingsPatch = createClientSettingsPersistenceQueue();
}

export function __setClientSettingsForTests(settings: ClientSettings): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = settings;
  clientSettingsHydrated = true;
  clientSettingsHydrationPromise = null;
}
