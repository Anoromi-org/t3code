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
type ClientSettingsHydrationStatus = "pending" | "ready" | "failed" | "retrying";
let clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
let clientSettingsHydrationStatus: ClientSettingsHydrationStatus = "pending";
let clientSettingsHydrationPromise: Promise<void> | null = null;
let clientSettingsHydrationGeneration = 0;
let clientSettingsPersistenceQueue: Promise<void> = Promise.resolve();
let deferredClientSettingsPatchCount = 0;

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

function setClientSettingsHydrationStatus(nextStatus: ClientSettingsHydrationStatus): void {
  if (clientSettingsHydrationStatus === nextStatus) {
    return;
  }
  clientSettingsHydrationStatus = nextStatus;
  emitClientSettingsHydrationChange();
}

function subscribeClientSettings(listener: () => void): () => void {
  clientSettingsListeners.add(listener);
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsListeners.delete(listener);
  };
}

function getClientSettingsHydratedSnapshot(): boolean {
  return clientSettingsHydrationStatus === "ready";
}

function getClientSettingsHydrationStatusSnapshot(): ClientSettingsHydrationStatus {
  return clientSettingsHydrationStatus;
}

function subscribeClientSettingsHydration(listener: () => void): () => void {
  clientSettingsHydrationListeners.add(listener);
  void hydrateClientSettings().catch(() => undefined);
  return () => {
    clientSettingsHydrationListeners.delete(listener);
  };
}

async function hydrateClientSettings(): Promise<void> {
  if (clientSettingsHydrationStatus === "ready") {
    return;
  }
  if (clientSettingsHydrationPromise) {
    return clientSettingsHydrationPromise;
  }

  const hydrationGeneration = clientSettingsHydrationGeneration;
  setClientSettingsHydrationStatus(
    clientSettingsHydrationStatus === "failed" || clientSettingsHydrationStatus === "retrying"
      ? "retrying"
      : "pending",
  );
  const nextHydration = (async () => {
    try {
      const persistedSettings = await ensureLocalApi().persistence.getClientSettings();
      if (hydrationGeneration !== clientSettingsHydrationGeneration) {
        return;
      }
      if (persistedSettings) {
        replaceClientSettingsSnapshot({ ...DEFAULT_CLIENT_SETTINGS, ...persistedSettings });
      }
      setClientSettingsHydrationStatus("ready");
    } catch (error) {
      if (hydrationGeneration === clientSettingsHydrationGeneration) {
        setClientSettingsHydrationStatus("failed");
      }
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} hydrate failed`, {
        operation: "hydrate",
        ...safeErrorLogAttributes(error),
      });
      throw error;
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
): Promise<void> {
  // Patches queued before hydration must publish before newer optimistic patches.
  const deferPatch =
    clientSettingsHydrationStatus !== "ready" || deferredClientSettingsPatchCount > 0;
  if (deferPatch) {
    deferredClientSettingsPatchCount += 1;
  } else {
    replaceClientSettingsSnapshot({ ...getClientSettingsSnapshot(), ...patch });
  }
  return enqueueClientSettingsPersistence(async () => {
    if (deferPatch) {
      try {
        if (clientSettingsHydrationStatus !== "ready") {
          await hydrateClientSettings();
        }
        replaceClientSettingsSnapshot({ ...getClientSettingsSnapshot(), ...patch });
      } finally {
        deferredClientSettingsPatchCount -= 1;
      }
    }
    await persist(getClientSettingsSnapshot());
  }).catch((error) => {
    console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} persist failed`, {
      operation: "persist",
      ...safeErrorLogAttributes(error),
    });
  });
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
    if (clientSettingsHydrationStatus !== "ready") {
      await hydrateClientSettings();
    }
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
 * Resolves after settings load or storage confirms no saved settings exist.
 * Failed reads reject and remain retryable. They must not allow defaults to
 * overwrite saved preferences.
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

export function useClientSettingsHydrationStatus(): ClientSettingsHydrationStatus {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydrationStatusSnapshot,
    () => "pending",
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
          const sourceSettings = environments.find(
            (target) => target.environmentId === environmentId,
          )?.serverConfig?.settings;
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
              target?.serverConfig?.settings,
              sourceSettings,
              targetId === environmentId,
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
        void persistClientSettingsPatch(clientPatch);
      }
    },
    [environmentId, environments, persistServerSettings],
  );

  return updateSettings;
}

type UnifiedSettingsUpdate =
  | UnifiedSettingsPatch
  | ((settings: UnifiedSettings) => UnifiedSettingsPatch);

type ClientSettingsUpdate =
  | ClientSettingsPatch
  | ((settings: ClientSettings) => ClientSettingsPatch);

export type SettingsOperationQueue = <A>(operation: () => Promise<A>) => Promise<A>;

/** Runs settings operations one at a time; a failed operation does not block later ones. */
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

interface SettingsOperationState {
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

/**
 * Tracks the last server settings a write returned so a queued functional
 * update resolves against them, not a projection that has not caught up yet.
 * A projection that matches no pending response is a genuine outside change
 * and becomes the new base.
 */
export function createSettingsOperationState(): SettingsOperationState {
  let lastProjectedServerSettings: ServerSettings | null = null;
  let durableServerSettings: ServerSettings | null = null;
  let pendingAuthoritativeSettings: ServerSettings[] = [];
  // Drops every response the projection has caught up to. Returns false when
  // the projection matches none of them.
  const acknowledge = (projected: ServerSettings): boolean => {
    const acknowledgedIndex = pendingAuthoritativeSettings.findLastIndex((authoritative) =>
      settingsValuesEqual(authoritative, projected),
    );
    if (acknowledgedIndex < 0) return false;
    if (acknowledgedIndex === pendingAuthoritativeSettings.length - 1) {
      durableServerSettings = projected;
    }
    pendingAuthoritativeSettings = pendingAuthoritativeSettings.slice(acknowledgedIndex + 1);
    return true;
  };
  return {
    enqueue: createSettingsOperationQueue(),
    resolveServerSettings(projected) {
      if (projected !== lastProjectedServerSettings) {
        lastProjectedServerSettings = projected;
        if (!acknowledge(projected)) {
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
      // The projection may already include this response. A projection that
      // predates it is remembered so the next read does not mistake it for an
      // outside change.
      const projected = projectedAtCompletion();
      lastProjectedServerSettings = projected;
      acknowledge(projected);
      return authoritative;
    },
  };
}

const settingsOperationStatesByRegistry = new WeakMap<
  object,
  Map<string, SettingsOperationState>
>();

function settingsOperationStateFor(registry: object, environmentId: EnvironmentId | null) {
  let states = settingsOperationStatesByRegistry.get(registry);
  if (!states) {
    states = new Map();
    settingsOperationStatesByRegistry.set(registry, states);
  }
  const key = environmentId ?? "primary";
  let state = states.get(key);
  if (!state) {
    state = createSettingsOperationState();
    states.set(key, state);
  }
  return state;
}

/** Server and client stores are independent: one failing must not skip the other. */
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

function persistClientSettingsFunctionalPatch(update: ClientSettingsUpdate): Promise<void> {
  return persistClientSettingsUpdate((current) => ({
    ...current,
    ...(typeof update === "function" ? update(current) : update),
  })).then(() => undefined);
}

/**
 * Awaitable settings writes. Functional updates for one environment run in
 * order, each against the durable result of the previous write, so rapid
 * edits to map-valued settings (provider instances, favorites) never drop one
 * another. Rejects when any targeted store fails to persist.
 */
function usePersistSettingsTarget(environmentId: EnvironmentId | null) {
  const registry = useContext(RegistryContext);
  const operationState = useMemo(
    () => settingsOperationStateFor(registry, environmentId),
    [environmentId, registry],
  );
  const persistServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
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
        const { serverPatch, clientPatch } = splitPatch(resolvePatch(getClientSettingsSnapshot()));

        const persistServer = async () => {
          const { sharedPatch, localPatch } = splitSharedServerPatch(serverPatch);
          if (Object.keys(localPatch).length > 0 && !environmentId) {
            throw new Error(PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE);
          }
          const targets = new Map<EnvironmentId, ServerSettingsPatch>();
          if (Object.keys(sharedPatch).length > 0) {
            const sourceSettings = environments.find(
              (target) => target.environmentId === environmentId,
            )?.serverConfig?.settings;
            const sharedTargets = new Set(
              environments.filter(supportsSharedSettingsSync).map((target) => target.environmentId),
            );
            if (environmentId) sharedTargets.add(environmentId);
            for (const targetId of sharedTargets) {
              const target = environments.find((candidate) => candidate.environmentId === targetId);
              const patch = filterSharedServerPatch(
                sharedPatch,
                target?.serverConfig?.environment.capabilities,
                target?.serverConfig?.settings,
                sourceSettings,
                targetId === environmentId,
              );
              if (Object.keys(patch).length > 0) targets.set(targetId, patch);
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
                if (isAtomCommandInterrupted(result)) {
                  throw new Error("The settings update was interrupted.");
                }
                const error = squashAtomCommandFailure(result);
                throw error instanceof Error ? error : new Error("Could not persist settings.");
              };
              if (targetId === environmentId) {
                await operationState.persistAuthoritativeServerSettings(
                  persist,
                  getProjectedServerSettings,
                );
              } else {
                await persist();
              }
            }),
          );
          for (const result of results) if (result.status === "rejected") throw result.reason;
        };

        await persistIndependentSettingsPatches({
          ...(Object.keys(serverPatch).length > 0 ? { persistServer } : {}),
          ...(Object.keys(clientPatch).length > 0
            ? {
                persistClient: () =>
                  persistClientSettingsFunctionalPatch(
                    typeof update === "function"
                      ? (clientSettings) => splitPatch(resolvePatch(clientSettings)).clientPatch
                      : clientPatch,
                  ),
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

/**
 * Patches write optimistically. Functional updates are queued and resolved
 * against durable settings; failures surface through the command reporter.
 */
function useUpdateSettingsTarget(environmentId: EnvironmentId | null) {
  const persistSettings = usePersistSettingsTarget(environmentId);
  const updatePatch = useUpdateSettingsPatchTarget(environmentId);
  return useCallback(
    (update: UnifiedSettingsUpdate) => {
      if (typeof update === "function") {
        void persistSettings(update).catch((error) => {
          toastManager.add({
            type: "error",
            title: "Setting not saved",
            description: error instanceof Error ? error.message : "Could not persist settings.",
          });
        });
      } else {
        updatePatch(update);
      }
    },
    [persistSettings, updatePatch],
  );
}

export function usePersistEnvironmentSettings(environmentId: EnvironmentId) {
  return usePersistSettingsTarget(environmentId);
}

/** Awaitable client-settings write that publishes only after persistence succeeds. */
export function usePersistClientSettings() {
  return persistClientSettingsFunctionalPatch;
}

export function useUpdateEnvironmentSettings(environmentId: EnvironmentId) {
  return useUpdateSettingsTarget(environmentId);
}

export function useUpdatePrimarySettings() {
  return useUpdateSettingsTarget(usePrimaryEnvironment()?.environmentId ?? null);
}

/**
 * Optimistic client-settings write. A functional update resolves against the
 * latest snapshot, which already includes earlier optimistic writes, so rapid
 * updates compose. Before hydration it waits for the saved settings instead.
 */
export function updateClientSettings(update: ClientSettingsUpdate): Promise<void> {
  if (typeof update !== "function") return persistClientSettingsPatch(update);
  if (clientSettingsHydrationStatus === "ready" && deferredClientSettingsPatchCount === 0) {
    return persistClientSettingsPatch(update(getClientSettingsSnapshot()));
  }
  return persistClientSettingsFunctionalPatch(update).catch((error) => {
    console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} persist failed`, {
      operation: "persist",
      ...safeErrorLogAttributes(error),
    });
  });
}

export function useUpdateClientSettings() {
  return updateClientSettings;
}

export function __resetClientSettingsPersistenceForTests(): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = DEFAULT_CLIENT_SETTINGS;
  clientSettingsHydrationStatus = "pending";
  clientSettingsHydrationPromise = null;
  clientSettingsPersistenceQueue = Promise.resolve();
  deferredClientSettingsPatchCount = 0;
  clientSettingsListeners.clear();
  clientSettingsHydrationListeners.clear();
}

export function __setClientSettingsForTests(settings: ClientSettings): void {
  clientSettingsHydrationGeneration += 1;
  clientSettingsSnapshot = settings;
  clientSettingsHydrationStatus = "ready";
  clientSettingsHydrationPromise = null;
}
