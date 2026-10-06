import type {
  DesktopHyprnavBrowserTab,
  DesktopHyprnavBrowserTabsThread,
  EnvironmentId,
  HyprnavBrowserSlot,
  ProjectHyprnavOverride,
  ProjectHyprnavSettings,
} from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";

import { hyprnavWorktreeTitle } from "./hyprnavRuntime";

/** Thread-scope slots a project binding owns; a browser slot never takes one over. */
export function hyprnavThreadBindingSlots(settings: ProjectHyprnavSettings): Set<number> {
  return new Set(
    settings.bindings
      .filter((binding) => binding.scope === "thread")
      .map((binding) => binding.slot),
  );
}

function browserSlotValue(
  slot: HyprnavBrowserSlot,
  thread: { readonly branch: string | null | undefined },
): string | null {
  switch (slot.value) {
    case "branch":
      return thread.branch?.trim() || null;
    default:
      return null;
  }
}

/**
 * The browser slots one thread should have. A thread without the slot's value
 * (no branch) gets none, so any earlier target for it is cleared.
 */
export function resolveHyprnavBrowserTabs(input: {
  readonly slots: readonly HyprnavBrowserSlot[];
  readonly thread: { readonly branch: string | null | undefined };
  readonly bindingSlots: ReadonlySet<number>;
}): DesktopHyprnavBrowserTab[] {
  const tabs: DesktopHyprnavBrowserTab[] = [];
  for (const slot of input.slots) {
    if (input.bindingSlots.has(slot.slot) || tabs.some((tab) => tab.slot === slot.slot)) continue;
    const value = browserSlotValue(slot, input.thread);
    if (value === null) continue;
    tabs.push({
      slot: slot.slot,
      workspaceId: slot.workspace,
      browser: slot.browser,
      tabName: slot.tabName,
      value,
    });
  }
  return tabs;
}

/** Slots T3 gave a browser target earlier that the thread no longer wants. */
export function computeHyprnavBrowserTabClears(
  previous: readonly number[] | undefined,
  desired: readonly DesktopHyprnavBrowserTab[],
): number[] {
  const kept = new Set(desired.map((tab) => tab.slot));
  return [...new Set(previous ?? [])].filter((slot) => !kept.has(slot)).toSorted((a, b) => a - b);
}

// ── Which slots T3 attached browser targets to, per thread ───────────

/** Thread key -> browser slots T3 may have attached. Persisted so removals clear after restarts. */
export type HyprnavBrowserTabHistory = Map<string, readonly number[]>;

interface BrowserTabHistoryStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const HYPRNAV_BROWSER_TAB_HISTORY_STORAGE_KEY = "t3code:hyprnav-browser-tabs:v1";

export function hyprnavBrowserTabHistoryKey(target: {
  readonly projectRoot: string;
  readonly worktreePath: string | null;
  readonly threadId: string;
}): string {
  return `${target.projectRoot}\0${target.worktreePath ?? target.projectRoot}\0${target.threadId}`;
}

/** Before a sync: remember every slot that may end up attached, so a failure cannot lose one. */
export function markHyprnavBrowserTabAttempt(
  history: HyprnavBrowserTabHistory,
  key: string,
  desired: readonly DesktopHyprnavBrowserTab[],
): void {
  const slots = new Set([...(history.get(key) ?? []), ...desired.map((tab) => tab.slot)]);
  if (slots.size === 0) return;
  history.set(
    key,
    [...slots].toSorted((a, b) => a - b),
  );
}

/** After a successful sync: exactly the desired slots are attached. */
export function recordHyprnavBrowserTabs(
  history: HyprnavBrowserTabHistory,
  key: string,
  desired: readonly DesktopHyprnavBrowserTab[],
): void {
  if (desired.length === 0) history.delete(key);
  else
    history.set(
      key,
      desired.map((tab) => tab.slot).toSorted((a, b) => a - b),
    );
}

function browserStorage(): BrowserTabHistoryStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isSlotList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((slot) => typeof slot === "number" && Number.isSafeInteger(slot) && slot > 0)
  );
}

export function loadHyprnavBrowserTabHistory(
  storage: BrowserTabHistoryStorage | null = browserStorage(),
): HyprnavBrowserTabHistory {
  if (!storage) return new Map();
  try {
    const raw = storage.getItem(HYPRNAV_BROWSER_TAB_HISTORY_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("entries" in parsed) ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length > 50_000
    ) {
      return new Map();
    }
    const history: HyprnavBrowserTabHistory = new Map();
    for (const entry of parsed.entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        !isSlotList(entry[1])
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

export function persistHyprnavBrowserTabHistory(
  history: ReadonlyMap<string, readonly number[]>,
  storage: BrowserTabHistoryStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(
      HYPRNAV_BROWSER_TAB_HISTORY_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [...history.entries()] }),
    );
  } catch {
    // Best effort, like the binding publication history.
  }
}

export const hyprnavBrowserTabHistory: HyprnavBrowserTabHistory = loadHyprnavBrowserTabHistory();

/**
 * Every primary-environment thread that needs its browser slots changed:
 * threads with a value get the slots, and slots T3 attached earlier but no
 * longer wants (removed entry, archived thread, lost branch) are cleared.
 */
export function buildHyprnavBrowserTabThreads(input: {
  readonly localEnvironmentId: EnvironmentId;
  readonly slots: readonly HyprnavBrowserSlot[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly projects: readonly EnvironmentProject[];
  readonly defaults: ProjectHyprnavSettings;
  readonly history: ReadonlyMap<string, readonly number[]>;
}): DesktopHyprnavBrowserTabsThread[] {
  const projectsById = new Map(
    input.projects
      .filter((project) => project.environmentId === input.localEnvironmentId)
      .map((project) => [project.id, project] as const),
  );
  const bindingSlotsByProject = new Map<string, Set<number>>();
  const bindingSlotsFor = (project: EnvironmentProject) => {
    let slots = bindingSlotsByProject.get(project.id);
    if (!slots) {
      const override: ProjectHyprnavOverride | undefined = project.hyprnav;
      slots = hyprnavThreadBindingSlots(override ?? input.defaults);
      bindingSlotsByProject.set(project.id, slots);
    }
    return slots;
  };
  const result: DesktopHyprnavBrowserTabsThread[] = [];
  for (const thread of input.threads) {
    if (thread.environmentId !== input.localEnvironmentId) continue;
    const project = projectsById.get(thread.projectId);
    if (!project) continue;
    const worktreePath = thread.worktreePath ?? null;
    const key = hyprnavBrowserTabHistoryKey({
      projectRoot: project.workspaceRoot,
      worktreePath,
      threadId: thread.id,
    });
    const bindingSlots = bindingSlotsFor(project);
    const browserTabs = thread.archivedAt
      ? []
      : resolveHyprnavBrowserTabs({ slots: input.slots, thread, bindingSlots });
    const clearBrowserTabs = computeHyprnavBrowserTabClears(input.history.get(key), browserTabs);
    if (browserTabs.length === 0 && clearBrowserTabs.length === 0) continue;
    result.push({
      projectRoot: project.workspaceRoot,
      worktreePath,
      threadId: thread.id,
      threadTitle: thread.title,
      projectTitle: project.title,
      worktreeTitle: hyprnavWorktreeTitle({
        branch: thread.branch,
        worktreePath,
        projectRoot: project.workspaceRoot,
      }),
      browserTabs,
      clearBrowserTabs,
      bindingSlots: [...bindingSlots],
    });
  }
  return result;
}
