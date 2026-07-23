import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import type {
  DesktopBridge,
  DesktopHyprnavScopedSlot,
  DesktopHyprnavSyncInput,
  DesktopHyprnavSyncResult,
  EditorId,
  EnvironmentId,
  ProjectHyprnavOverride,
  ProjectHyprnavScope,
  ProjectHyprnavSettings,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { attachWebSocketTicket } from "@t3tools/client-runtime/authorization";
import * as Effect from "effect/Effect";

import { PrimaryEnvironmentHttpClient } from "./environments/primary/httpClient";
import { runPrimaryHttp } from "./lib/runtime";

export const HYPRNAV_SYNC_RETRY_DELAYS_MS = [250, 1_000] as const;
export const HYPRNAV_CREDENTIAL_REFRESH_DELAY_MS = 4 * 60_000;

const CORKDIFF_PLACEHOLDERS = [
  "{corkdiffLaunchCommand}",
  "{corkdiffServerUrl}",
  "{corkdiffToken}",
] as const;

export interface HyprnavPublicationTarget {
  readonly projectRoot: string;
  readonly worktreePath: string | null;
  readonly threadId: ScopedThreadRef["threadId"] | null;
  readonly threadTitle: string | null;
}

export interface ActiveHyprnavSyncTarget extends HyprnavPublicationTarget {
  readonly threadId: ScopedThreadRef["threadId"];
  readonly threadTitle: string;
}

export function createActiveHyprnavRequestKey(input: {
  readonly target: ActiveHyprnavSyncTarget | null;
  readonly settings: ProjectHyprnavSettings;
  readonly availableEditors: readonly EditorId[];
}): string | null {
  return input.target
    ? JSON.stringify({
        target: input.target,
        settings: input.settings,
        availableEditors: input.availableEditors,
      })
    : null;
}

export interface HyprnavPublicationScopeState {
  readonly slots: ReadonlyArray<{
    readonly slot: number;
    readonly named: boolean;
  }>;
}

export type HyprnavPublicationHistory = Map<string, readonly HyprnavPublicationScopeState[]>;

interface HyprnavPublicationStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const HYPRNAV_PUBLICATION_HISTORY_STORAGE_KEY = "t3code:hyprnav-publication-history:v1";

const HYPRNAV_SCOPES = [
  "project",
  "worktree",
  "thread",
] as const satisfies readonly ProjectHyprnavScope[];

function publicationScopeKey(target: HyprnavPublicationTarget, scope: ProjectHyprnavScope): string {
  const targetPath = target.worktreePath ?? target.projectRoot;
  switch (scope) {
    case "project":
      return `project\0${target.projectRoot}`;
    case "worktree":
      return `worktree\0${target.projectRoot}\0${targetPath}`;
    case "thread":
      return `thread\0${target.projectRoot}\0${targetPath}\0${target.threadId}`;
  }
}

function stateForScope(
  settings: ProjectHyprnavSettings,
  scope: ProjectHyprnavScope,
): HyprnavPublicationScopeState {
  return {
    slots: settings.bindings
      .filter((binding) => binding.scope === scope)
      .map((binding) => ({
        slot: binding.slot,
        named: Boolean(binding.name?.trim()),
      })),
  };
}

export function computeActiveHyprnavCleanup(input: {
  readonly history: ReadonlyMap<string, readonly HyprnavPublicationScopeState[]>;
  readonly target: HyprnavPublicationTarget;
  readonly settings: ProjectHyprnavSettings;
  readonly scopes?: readonly ProjectHyprnavScope[];
}): {
  readonly clearBindings: DesktopHyprnavScopedSlot[];
  readonly clearNames: DesktopHyprnavScopedSlot[];
} {
  const clearBindings: DesktopHyprnavScopedSlot[] = [];
  const clearNames: DesktopHyprnavScopedSlot[] = [];
  const clearedBindingKeys = new Set<string>();
  const clearedNameKeys = new Set<string>();
  for (const scope of input.scopes ?? HYPRNAV_SCOPES) {
    const previousCandidates = input.history.get(publicationScopeKey(input.target, scope));
    if (!previousCandidates) continue;
    const nextBySlot = new Map(
      input.settings.bindings
        .filter((binding) => binding.scope === scope)
        .map((binding) => [binding.slot, binding]),
    );
    for (const previous of previousCandidates) {
      for (const binding of previous.slots) {
        const key = `${scope}:${String(binding.slot)}`;
        const next = nextBySlot.get(binding.slot);
        if (!next && !clearedBindingKeys.has(key)) {
          clearedBindingKeys.add(key);
          clearBindings.push({ scope, slot: binding.slot });
        } else if (
          next &&
          binding.named &&
          !(next.name?.trim() ?? "") &&
          !clearedNameKeys.has(key)
        ) {
          clearedNameKeys.add(key);
          clearNames.push({ scope, slot: binding.slot });
        }
      }
    }
  }
  return { clearBindings, clearNames };
}

export function recordActiveHyprnavPublication(input: {
  readonly history: HyprnavPublicationHistory;
  readonly target: HyprnavPublicationTarget;
  readonly settings: ProjectHyprnavSettings;
  readonly appliedScopes?: readonly ProjectHyprnavScope[];
}): void {
  const appliedScopes = new Set(input.appliedScopes ?? HYPRNAV_SCOPES);
  for (const scope of HYPRNAV_SCOPES) {
    if (!appliedScopes.has(scope)) continue;
    input.history.set(publicationScopeKey(input.target, scope), [
      stateForScope(input.settings, scope),
    ]);
  }
}

export function markActiveHyprnavPublicationAttempt(input: {
  readonly history: HyprnavPublicationHistory;
  readonly target: HyprnavPublicationTarget;
  readonly settings: ProjectHyprnavSettings;
  readonly scopes?: readonly ProjectHyprnavScope[];
}): void {
  for (const scope of input.scopes ?? HYPRNAV_SCOPES) {
    const key = publicationScopeKey(input.target, scope);
    const scoped = stateForScope(input.settings, scope);
    const signature = JSON.stringify(scoped);
    const candidates = input.history.get(key) ?? [];
    if (!candidates.some((candidate) => JSON.stringify(candidate) === signature)) {
      input.history.set(key, [...candidates, scoped]);
    }
  }
}

function browserPublicationStorage(): HyprnavPublicationStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isPublicationScopeState(value: unknown): value is HyprnavPublicationScopeState {
  return (
    typeof value === "object" &&
    value !== null &&
    "slots" in value &&
    Array.isArray(value.slots) &&
    value.slots.length <= 1_000 &&
    value.slots.every(
      (slot) =>
        typeof slot === "object" &&
        slot !== null &&
        "slot" in slot &&
        typeof slot.slot === "number" &&
        Number.isSafeInteger(slot.slot) &&
        slot.slot > 0 &&
        "named" in slot &&
        typeof slot.named === "boolean",
    )
  );
}

export function loadHyprnavPublicationHistory(
  storage: HyprnavPublicationStorage | null = browserPublicationStorage(),
): HyprnavPublicationHistory {
  if (!storage) return new Map();
  try {
    const raw = storage.getItem(HYPRNAV_PUBLICATION_HISTORY_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("entries" in parsed) ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length > 10_000
    ) {
      return new Map();
    }
    const history: HyprnavPublicationHistory = new Map();
    for (const entry of parsed.entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        !Array.isArray(entry[1]) ||
        entry[1].length > 100 ||
        !entry[1].every(isPublicationScopeState)
      ) {
        return new Map();
      }
      history.set(entry[0], entry[1]);
    }
    return history;
  } catch {
    return new Map();
  }
}

export function persistHyprnavPublicationHistory(
  history: ReadonlyMap<string, readonly HyprnavPublicationScopeState[]>,
  storage: HyprnavPublicationStorage | null = browserPublicationStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      HYPRNAV_PUBLICATION_HISTORY_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [...history.entries()] }),
    );
  } catch {
    // Runtime synchronization remains best effort when browser storage is unavailable.
  }
}

/** Shared renderer history used by active-thread and settings-triggered publication. */
export const hyprnavPublicationHistory: HyprnavPublicationHistory = loadHyprnavPublicationHistory();

export function hyprnavPublicationTargetFromRequest(
  request: DesktopHyprnavSyncInput,
): HyprnavPublicationTarget {
  return {
    projectRoot: request.projectRoot,
    worktreePath: request.worktreePath ?? null,
    threadId: request.threadId ? (request.threadId as ScopedThreadRef["threadId"]) : null,
    threadTitle: request.threadTitle ?? null,
  };
}

export function hyprnavPublicationScopesForRequest(
  request: DesktopHyprnavSyncInput,
): readonly ProjectHyprnavScope[] {
  if (request.threadId) return ["thread"];
  if (request.worktreePath) return ["worktree"];
  return ["project", "worktree"];
}

export function isHyprnavDesktopRuntimeAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.syncHyprnavEnvironment === "function"
  );
}

export function resolveEffectiveHyprnavSettings(
  projectOverride: ProjectHyprnavOverride | undefined,
  defaults: ProjectHyprnavSettings,
): ProjectHyprnavSettings {
  return projectOverride ?? defaults;
}

export function resolveActiveHyprnavSyncTarget(input: {
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly thread: EnvironmentThreadShell | null;
  readonly project: EnvironmentProject | null;
}): ActiveHyprnavSyncTarget | null {
  if (
    input.primaryEnvironmentId === null ||
    input.thread?.environmentId !== input.primaryEnvironmentId
  ) {
    return null;
  }
  if (
    input.project?.environmentId !== input.thread.environmentId ||
    input.project.id !== input.thread.projectId
  ) {
    return null;
  }
  return {
    projectRoot: input.project.workspaceRoot,
    worktreePath: input.thread.worktreePath ?? null,
    threadId: input.thread.id,
    threadTitle: input.thread.title,
  };
}

export function hyprnavNeedsCorkdiffConnection(settings: ProjectHyprnavSettings): boolean {
  return settings.bindings.some(
    (binding) =>
      binding.action === "shell-command" &&
      CORKDIFF_PLACEHOLDERS.some((placeholder) => binding.command.includes(placeholder)),
  );
}

export function hyprnavCredentialRefreshDelay(settings: ProjectHyprnavSettings): number | null {
  return hyprnavNeedsCorkdiffConnection(settings) ? HYPRNAV_CREDENTIAL_REFRESH_DELAY_MS : null;
}

export function hyprnavSyncNeedsScopeRetry(
  request: DesktopHyprnavSyncInput,
  result: DesktopHyprnavSyncResult,
): boolean {
  if (result.status !== "ok" || result.appliedScopes === undefined) return false;

  const requestedScopes = new Set<ProjectHyprnavScope>([
    ...request.hyprnav.bindings.map((binding) => binding.scope),
    ...(request.clearBindings ?? []).map((binding) => binding.scope),
    ...(request.clearNames ?? []).map((binding) => binding.scope),
    ...(request.lock && request.threadId ? (["thread"] as const) : []),
  ]);
  const appliedScopes = new Set(result.appliedScopes);
  return [...requestedScopes].some((scope) => !appliedScopes.has(scope));
}

export function waitForHyprnavRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export function createCancelableHyprnavDelay(): {
  readonly wait: (delayMs: number) => Promise<void>;
  readonly cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    wake?.();
    wake = null;
  };
  return {
    wait: (delayMs) => {
      cancel();
      return new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(() => {
          timer = null;
          wake = null;
          resolve();
        }, delayMs);
      });
    },
    cancel,
  };
}

export async function syncHyprnavWithRetry(input: {
  readonly sync: NonNullable<DesktopBridge["syncHyprnavEnvironment"]>;
  readonly request: DesktopHyprnavSyncInput;
  readonly retryDelaysMs?: readonly number[];
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly isCurrent?: () => boolean;
  readonly onBeforeSync?: () => void;
}): Promise<DesktopHyprnavSyncResult> {
  const retryDelays = input.retryDelaysMs ?? HYPRNAV_SYNC_RETRY_DELAYS_MS;
  const wait = input.wait ?? waitForHyprnavRetry;
  const superseded = {
    status: "error" as const,
    message: "Hyprnav publication superseded.",
  };
  if (input.isCurrent && !input.isCurrent()) return superseded;
  input.onBeforeSync?.();
  let result = await input.sync(input.request);
  for (const delayMs of retryDelays) {
    if (result.status === "ok" && !hyprnavSyncNeedsScopeRetry(input.request, result)) return result;
    await wait(delayMs);
    if (input.isCurrent && !input.isCurrent()) return superseded;
    input.onBeforeSync?.();
    result = await input.sync(input.request);
  }
  if (result.status === "ok" && hyprnavSyncNeedsScopeRetry(input.request, result)) {
    return {
      status: "error",
      message: "Hyprnav did not apply every requested scope.",
      ...(result.appliedScopes ? { appliedScopes: result.appliedScopes } : {}),
    };
  }
  return result;
}

export function getPrimaryDesktopBootstrap() {
  return (
    window.desktopBridge
      ?.getLocalEnvironmentBootstraps()
      .find((bootstrap) => bootstrap.id === PRIMARY_LOCAL_ENVIRONMENT_ID) ?? null
  );
}

export function attachHyprnavWebSocketTicket(wsBaseUrl: string, ticket: string): string {
  return attachWebSocketTicket(wsBaseUrl, ticket, "token");
}

export async function resolveHyprnavCorkdiffConnection(): Promise<{
  readonly serverUrl: string;
  readonly token: null;
}> {
  const bootstrap = getPrimaryDesktopBootstrap();
  if (!bootstrap?.wsBaseUrl) throw new Error("Desktop websocket URL is unavailable.");

  const issued = await runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.auth.webSocketTicket({ headers: {} })),
    ),
  );
  return {
    serverUrl: attachHyprnavWebSocketTicket(bootstrap.wsBaseUrl, issued.ticket),
    token: null,
  };
}

export function preferredEditorForHyprnav(
  requests: readonly DesktopHyprnavSyncInput[],
  availableEditors: readonly EditorId[],
  resolvePreferredEditor: (available: readonly EditorId[]) => EditorId | null,
): EditorId | null {
  const needsEditor = requests.some((request) =>
    request.hyprnav.bindings.some((binding) => binding.action === "open-favorite-editor"),
  );
  return needsEditor ? resolvePreferredEditor(availableEditors) : null;
}

function isBatchWideRuntimeUnavailable(result: DesktopHyprnavSyncResult): boolean {
  return (
    result.status === "unavailable" &&
    result.message === "hyprnav is not installed or not available in PATH."
  );
}

function bindingNeedsCorkdiffConnection(
  binding: ProjectHyprnavSettings["bindings"][number],
): boolean {
  return (
    binding.action === "shell-command" &&
    CORKDIFF_PLACEHOLDERS.some((placeholder) => binding.command.includes(placeholder))
  );
}

function requestHasSyncWork(request: DesktopHyprnavSyncInput): boolean {
  return (
    request.hyprnav.bindings.length > 0 ||
    (request.clearBindings?.length ?? 0) > 0 ||
    (request.clearNames?.length ?? 0) > 0 ||
    request.lock
  );
}

export async function publishHyprnavRequests(input: {
  readonly requests: readonly DesktopHyprnavSyncInput[];
  readonly availableEditors: readonly EditorId[];
  readonly resolvePreferredEditor: (available: readonly EditorId[]) => EditorId | null;
  readonly resolveCorkdiffConnection?: typeof resolveHyprnavCorkdiffConnection;
  readonly isCurrent?: () => boolean;
  readonly onBeforeSync?: (request: DesktopHyprnavSyncInput) => void;
  readonly onAfterSync?: (
    request: DesktopHyprnavSyncInput,
    result: DesktopHyprnavSyncResult,
  ) => void;
}): Promise<DesktopHyprnavSyncResult> {
  const sync = window.desktopBridge?.syncHyprnavEnvironment;
  if (typeof sync !== "function") {
    return {
      status: "unavailable",
      message: "The Hyprnav desktop runtime is unavailable.",
    };
  }

  const preferredEditor = preferredEditorForHyprnav(
    input.requests,
    input.availableEditors,
    input.resolvePreferredEditor,
  );
  const appliedScopes = new Set<ProjectHyprnavScope>();
  let firstFailure: DesktopHyprnavSyncResult | null = null;
  let cachedCorkdiffConnection: Awaited<
    ReturnType<typeof resolveHyprnavCorkdiffConnection>
  > | null = null;
  let corkdiffConnectionFailure: DesktopHyprnavSyncResult | null = null;
  let runtimeUnavailableFailure: DesktopHyprnavSyncResult | null = null;
  const recordSkippedFailure = (
    request: DesktopHyprnavSyncInput,
    result: DesktopHyprnavSyncResult,
  ) => {
    input.onBeforeSync?.(request);
    input.onAfterSync?.(request, result);
    firstFailure ??= result;
  };
  for (const request of input.requests) {
    if (input.isCurrent && !input.isCurrent()) {
      return { status: "error", message: "Hyprnav publication superseded." };
    }
    let syncRequest = request;
    const omitBindings = (
      predicate: (binding: ProjectHyprnavSettings["bindings"][number]) => boolean,
      failure: DesktopHyprnavSyncResult,
    ) => {
      const omitted = syncRequest.hyprnav.bindings.filter(predicate);
      const bindings = syncRequest.hyprnav.bindings.filter((binding) => !predicate(binding));
      if (bindings.length === syncRequest.hyprnav.bindings.length) return;
      firstFailure ??= failure;
      const clearBindings = [
        ...new Map(
          [
            ...(syncRequest.clearBindings ?? []),
            ...omitted.map((binding) => ({ scope: binding.scope, slot: binding.slot })),
          ].map((binding) => [`${binding.scope}:${String(binding.slot)}`, binding]),
        ).values(),
      ];
      syncRequest = { ...syncRequest, hyprnav: { bindings }, clearBindings };
    };

    if (!syncRequest.threadId) {
      omitBindings(
        (binding) =>
          binding.action === "shell-command" && binding.command.includes("{corkdiffLaunchCommand}"),
        {
          status: "error",
          message: "Hyprnav command requires {corkdiffLaunchCommand} for this scope.",
        },
      );
    }

    const needsCorkdiff = syncRequest.hyprnav.bindings.some(bindingNeedsCorkdiffConnection);
    let corkdiffConnection: Awaited<ReturnType<typeof resolveHyprnavCorkdiffConnection>> | null =
      cachedCorkdiffConnection;
    if (needsCorkdiff && corkdiffConnectionFailure) {
      omitBindings(bindingNeedsCorkdiffConnection, corkdiffConnectionFailure);
    } else if (needsCorkdiff && !corkdiffConnection) {
      try {
        corkdiffConnection = await (
          input.resolveCorkdiffConnection ?? resolveHyprnavCorkdiffConnection
        )();
        cachedCorkdiffConnection = corkdiffConnection;
      } catch (error) {
        corkdiffConnectionFailure = {
          status: "error",
          message:
            error instanceof Error ? error.message : "Could not resolve Corkdiff credentials.",
        };
        omitBindings(bindingNeedsCorkdiffConnection, corkdiffConnectionFailure);
      }
    }
    const needsEditor = syncRequest.hyprnav.bindings.some(
      (binding) => binding.action === "open-favorite-editor",
    );
    if (needsEditor && preferredEditor === null) {
      omitBindings((binding) => binding.action === "open-favorite-editor", {
        status: "unavailable",
        message: "No available favorite editor is configured.",
      });
    }
    if (!requestHasSyncWork(syncRequest)) continue;
    if (runtimeUnavailableFailure) {
      recordSkippedFailure(syncRequest, runtimeUnavailableFailure);
      continue;
    }
    let result: DesktopHyprnavSyncResult;
    try {
      result = await syncHyprnavWithRetry({
        sync,
        request: { ...syncRequest, preferredEditor, corkdiffConnection },
        ...(input.isCurrent ? { isCurrent: input.isCurrent } : {}),
        ...(input.onBeforeSync ? { onBeforeSync: () => input.onBeforeSync?.(syncRequest) } : {}),
      });
    } catch (error) {
      result = {
        status: "error",
        message: error instanceof Error ? error.message : "Hyprnav synchronization failed.",
      };
    }
    input.onAfterSync?.(syncRequest, result);
    if (result.status !== "ok") {
      firstFailure ??= result;
      if (isBatchWideRuntimeUnavailable(result)) runtimeUnavailableFailure = result;
      continue;
    }
    const fallbackScopes = [
      ...syncRequest.hyprnav.bindings.map((binding) => binding.scope),
      ...(syncRequest.clearBindings ?? []).map((binding) => binding.scope),
      ...(syncRequest.clearNames ?? []).map((binding) => binding.scope),
      ...(syncRequest.lock ? (["thread"] as const) : []),
    ];
    for (const scope of result.appliedScopes ?? fallbackScopes) appliedScopes.add(scope);
  }
  if (firstFailure) {
    return appliedScopes.size > 0
      ? { ...firstFailure, appliedScopes: [...appliedScopes] }
      : firstFailure;
  }
  return {
    status: "ok",
    message: null,
    appliedScopes: [...appliedScopes],
  };
}
