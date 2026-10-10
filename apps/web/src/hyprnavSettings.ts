import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  DesktopHyprnavScopedSlot,
  ProjectHyprnavOverride,
  EnvironmentId,
  ProjectHyprnavAction,
  ProjectHyprnavScope,
  ProjectHyprnavSettings,
  ProjectHyprnavWorkspaceTarget,
} from "@t3tools/contracts";
import { hyprnavWorktreeTitle } from "./hyprnavRuntime";
import { derivePhysicalProjectKey, type ProjectGroupingSettings } from "./logicalProject";
import { deduplicateProjectsByPhysicalKey } from "./sidebarProjectGrouping";
import type { Project, Thread, ThreadShell } from "./types";

export const HYPRNAV_ACTION_ROWS: ReadonlyArray<{
  key: ProjectHyprnavAction;
  label: string;
}> = [
  { key: "worktree-terminal", label: "Worktree terminal" },
  { key: "open-favorite-editor", label: "Open favorite editor" },
  { key: "nothing", label: "Nothing" },
  { key: "shell-command", label: "Shell command" },
] as const;

export const HYPRNAV_SCOPE_ROWS: ReadonlyArray<{
  key: ProjectHyprnavScope;
  label: string;
}> = [
  { key: "project", label: "Once per project" },
  { key: "worktree", label: "Once per worktree" },
  { key: "thread", label: "Once per thread" },
] as const;

export const HYPRNAV_WORKSPACE_ROWS: ReadonlyArray<{
  key: ProjectHyprnavWorkspaceTarget["mode"];
  label: string;
}> = [
  { key: "managed", label: "Managed" },
  { key: "absolute", label: "Absolute workspace" },
] as const;

export function findHyprnavActionLabel(action: ProjectHyprnavAction): string {
  return HYPRNAV_ACTION_ROWS.find((row) => row.key === action)?.label ?? action;
}

export function findHyprnavScopeLabel(scope: ProjectHyprnavScope): string {
  return HYPRNAV_SCOPE_ROWS.find((row) => row.key === scope)?.label ?? scope;
}

function hyprnavScopeSlotKey(scope: ProjectHyprnavScope, slot: number): string {
  return `${scope}:${String(slot)}`;
}

export function findHyprnavWorkspaceLabel(mode: ProjectHyprnavWorkspaceTarget["mode"]): string {
  return HYPRNAV_WORKSPACE_ROWS.find((row) => row.key === mode)?.label ?? mode;
}

export function resolveProjectHyprnavSettings(
  projectHyprnavOverride: ProjectHyprnavOverride | undefined,
  defaultProjectHyprnavSettings: ProjectHyprnavSettings,
): ProjectHyprnavSettings {
  return projectHyprnavOverride ?? defaultProjectHyprnavSettings;
}

/**
 * Duplicate records of one physical checkout share a single Hyprnav source:
 * the record that project grouping retains, which is the one settings saves
 * write. Threads of a stale duplicate must read the same overrides.
 */
export function resolveRetainedHyprnavProject<P extends Project>(input: {
  readonly project: P;
  readonly projects: readonly P[];
  readonly groupingSettings: ProjectGroupingSettings;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): P {
  const physicalKey = derivePhysicalProjectKey(input.project);
  const duplicates = input.projects.filter(
    (candidate) => derivePhysicalProjectKey(candidate) === physicalKey,
  );
  if (duplicates.length < 2) return input.project;
  const [retained] = deduplicateProjectsByPhysicalKey({
    projects: duplicates,
    settings: input.groupingSettings,
    primaryEnvironmentId: input.primaryEnvironmentId,
  });
  return duplicates.find((candidate) => candidate === retained) ?? input.project;
}

export function projectUsesDefaultHyprnav(
  projectHyprnavOverride: ProjectHyprnavOverride | undefined,
): boolean {
  return projectHyprnavOverride === null || projectHyprnavOverride === undefined;
}

export function validateProjectHyprnavSettings(settings: ProjectHyprnavSettings): {
  duplicateScopedSlots: ReadonlyArray<DesktopHyprnavScopedSlot>;
  emptyShellCommandBindingIds: string[];
} {
  const seen = new Set<string>();
  const duplicateScopedSlots = new Map<string, DesktopHyprnavScopedSlot>();
  const emptyShellCommandBindingIds: string[] = [];

  for (const binding of settings.bindings) {
    const key = hyprnavScopeSlotKey(binding.scope, binding.slot);
    if (seen.has(key)) {
      duplicateScopedSlots.set(key, { scope: binding.scope, slot: binding.slot });
    } else {
      seen.add(key);
    }
    if (binding.action === "shell-command" && binding.command.trim().length === 0) {
      emptyShellCommandBindingIds.push(binding.id);
    }
  }

  return {
    duplicateScopedSlots: [...duplicateScopedSlots.values()].toSorted((left, right) =>
      left.scope === right.scope ? left.slot - right.slot : left.scope.localeCompare(right.scope),
    ),
    emptyShellCommandBindingIds,
  };
}

export function computeRemovedHyprnavBindings(
  previous: ProjectHyprnavSettings | null | undefined,
  next: ProjectHyprnavSettings,
): DesktopHyprnavScopedSlot[] {
  if (!previous) {
    return [];
  }

  const nextKeys = new Set(
    next.bindings.map((binding) => hyprnavScopeSlotKey(binding.scope, binding.slot)),
  );
  const removed = new Map<string, DesktopHyprnavScopedSlot>();
  for (const binding of previous.bindings) {
    const key = hyprnavScopeSlotKey(binding.scope, binding.slot);
    if (!nextKeys.has(key)) {
      removed.set(key, { scope: binding.scope, slot: binding.slot });
    }
  }
  return [...removed.values()].toSorted((left, right) =>
    left.scope === right.scope ? left.slot - right.slot : left.scope.localeCompare(right.scope),
  );
}

export function computeClearedHyprnavBindingNames(
  previous: ProjectHyprnavSettings | null | undefined,
  next: ProjectHyprnavSettings,
): DesktopHyprnavScopedSlot[] {
  if (!previous) {
    return [];
  }

  const nextByKey = new Map(
    next.bindings.map(
      (binding) => [hyprnavScopeSlotKey(binding.scope, binding.slot), binding] as const,
    ),
  );
  const cleared = new Map<string, DesktopHyprnavScopedSlot>();
  for (const binding of previous.bindings) {
    const previousName = binding.name?.trim() ?? "";
    if (previousName.length === 0) {
      continue;
    }
    const key = hyprnavScopeSlotKey(binding.scope, binding.slot);
    const nextBinding = nextByKey.get(key);
    if (!nextBinding) {
      continue;
    }
    const nextName = nextBinding.name?.trim() ?? "";
    if (nextName.length === 0) {
      cleared.set(key, { scope: binding.scope, slot: binding.slot });
    }
  }

  return [...cleared.values()].toSorted((left, right) =>
    left.scope === right.scope ? left.slot - right.slot : left.scope.localeCompare(right.scope),
  );
}

export interface ProjectHyprnavSyncJob {
  projectRoot: string;
  worktreePath: string | null;
  threadId: string | null;
  threadTitle: string | null;
  projectTitle: string | null;
  worktreeTitle: string | null;
  hyprnav: ProjectHyprnavSettings;
  clearBindings: DesktopHyprnavScopedSlot[];
  clearNames: DesktopHyprnavScopedSlot[];
  lock: boolean;
}

export { hyprnavNeedsCorkdiffConnection as projectHyprnavNeedsCorkdiffConnection } from "./hyprnavRuntime";

function filterHyprnavBindingsByScopes(
  settings: ProjectHyprnavSettings,
  scopes: readonly ProjectHyprnavScope[],
): ProjectHyprnavSettings {
  const scopeSet = new Set(scopes);
  return {
    bindings: settings.bindings.filter((binding) => scopeSet.has(binding.scope)),
  };
}

function filterScopedSlotsByScopes(
  bindings: readonly DesktopHyprnavScopedSlot[],
  scopes: readonly ProjectHyprnavScope[],
): DesktopHyprnavScopedSlot[] {
  const scopeSet = new Set(scopes);
  return bindings.filter((binding) => scopeSet.has(binding.scope));
}

export function buildProjectHyprnavSyncJobs(input: {
  localEnvironmentId: EnvironmentId;
  projects: readonly (Pick<Project, "environmentId" | "id" | "workspaceRoot" | "title"> & {
    hyprnav: ProjectHyprnavSettings;
  })[];
  knownProjects: readonly Pick<Project, "environmentId" | "id" | "workspaceRoot">[];
  threadShells: readonly ThreadShell[];
  activeThread:
    | Pick<Thread, "id" | "environmentId" | "projectId" | "worktreePath" | "title" | "branch">
    | null
    | undefined;
  clearBindingsByProjectKey: ReadonlyMap<string, readonly DesktopHyprnavScopedSlot[]>;
  clearNamesByProjectKey: ReadonlyMap<string, readonly DesktopHyprnavScopedSlot[]>;
  /**
   * Keeps a thread job that has no bindings or settings-diff cleanup, e.g.
   * when an earlier failed publication may have left slots applied.
   */
  hasPendingThreadCleanup?: (thread: {
    readonly projectRoot: string;
    readonly worktreePath: string | null;
    readonly threadId: ThreadShell["id"];
    readonly threadTitle: string;
  }) => boolean;
}): ProjectHyprnavSyncJob[] {
  const BASE_JOB_SCOPES = ["project", "worktree"] as const satisfies readonly ProjectHyprnavScope[];
  const WORKTREE_JOB_SCOPES = ["worktree"] as const satisfies readonly ProjectHyprnavScope[];
  const THREAD_JOB_SCOPES = ["thread"] as const satisfies readonly ProjectHyprnavScope[];
  const localProjectsByKey = new Map(
    input.projects
      .filter((project) => project.environmentId === input.localEnvironmentId)
      .map(
        (project) =>
          [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
      ),
  );
  const localProjectsByPhysicalKey = new Map(
    [...localProjectsByKey.values()].map(
      (project) => [derivePhysicalProjectKey(project), project] as const,
    ),
  );
  const knownLocalProjectsByKey = new Map(
    [...input.knownProjects, ...input.projects]
      .filter((project) => project.environmentId === input.localEnvironmentId)
      .map(
        (project) =>
          [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
      ),
  );
  const resolveTargetProject = (environmentId: EnvironmentId, projectId: Project["id"]) => {
    const sourceProjectKey = scopedProjectKey(scopeProjectRef(environmentId, projectId));
    const directProject = localProjectsByKey.get(sourceProjectKey);
    if (directProject) return { projectKey: sourceProjectKey, project: directProject };

    const knownProject = knownLocalProjectsByKey.get(sourceProjectKey);
    if (!knownProject) return null;
    const project = localProjectsByPhysicalKey.get(derivePhysicalProjectKey(knownProject));
    if (!project) return null;
    return {
      projectKey: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      project,
    };
  };

  // One branch per worktree target so every job touching the same hyprnav
  // worktree environment publishes the same title.
  const branchKey = (projectKey: string, targetPath: string) => `${projectKey}\u0000${targetPath}`;
  const branchByWorktree = new Map<string, string>();
  const rememberBranch = (
    thread: Pick<Thread, "environmentId" | "projectId" | "worktreePath" | "branch">,
    override: boolean,
  ) => {
    if (thread.environmentId !== input.localEnvironmentId || !thread.branch) return;
    const target = resolveTargetProject(thread.environmentId, thread.projectId);
    if (!target) return;
    const key = branchKey(target.projectKey, thread.worktreePath ?? target.project.workspaceRoot);
    if (override || !branchByWorktree.has(key)) branchByWorktree.set(key, thread.branch);
  };
  for (const thread of input.threadShells) rememberBranch(thread, false);
  if (input.activeThread) rememberBranch(input.activeThread, true);

  const jobsByKey = new Map<string, ProjectHyprnavSyncJob>();

  const addJob = (jobInput: {
    projectKey: string;
    projectRoot: string;
    projectTitle: string;
    worktreePath: string | null;
    threadId: string | null;
    threadTitle: string | null;
    hyprnav: ProjectHyprnavSettings;
    clearBindings: readonly DesktopHyprnavScopedSlot[];
    clearNames: readonly DesktopHyprnavScopedSlot[];
    lock: boolean;
  }) => {
    const key = `${jobInput.projectRoot}\u0000${jobInput.worktreePath ?? ""}\u0000${jobInput.threadId ?? ""}`;
    const clearBindings = [...jobInput.clearBindings];
    const clearNames = [...jobInput.clearNames];
    const existing = jobsByKey.get(key);
    if (existing) {
      existing.lock = existing.lock || jobInput.lock;
      existing.hyprnav = jobInput.hyprnav;
      existing.threadTitle = jobInput.threadTitle ?? existing.threadTitle;
      existing.clearBindings = [
        ...new Map(
          [...existing.clearBindings, ...clearBindings].map((binding) => [
            hyprnavScopeSlotKey(binding.scope, binding.slot),
            binding,
          ]),
        ).values(),
      ].toSorted((left, right) =>
        left.scope === right.scope ? left.slot - right.slot : left.scope.localeCompare(right.scope),
      );
      existing.clearNames = [
        ...new Map(
          [...existing.clearNames, ...clearNames].map((binding) => [
            hyprnavScopeSlotKey(binding.scope, binding.slot),
            binding,
          ]),
        ).values(),
      ].toSorted((left, right) =>
        left.scope === right.scope ? left.slot - right.slot : left.scope.localeCompare(right.scope),
      );
      return;
    }

    jobsByKey.set(key, {
      projectRoot: jobInput.projectRoot,
      worktreePath: jobInput.worktreePath,
      threadId: jobInput.threadId,
      threadTitle: jobInput.threadTitle,
      projectTitle: jobInput.projectTitle,
      worktreeTitle: hyprnavWorktreeTitle({
        branch: branchByWorktree.get(
          branchKey(jobInput.projectKey, jobInput.worktreePath ?? jobInput.projectRoot),
        ),
        worktreePath: jobInput.worktreePath,
        projectRoot: jobInput.projectRoot,
      }),
      hyprnav: jobInput.hyprnav,
      clearBindings,
      clearNames,
      lock: jobInput.lock,
    });
  };

  for (const thread of input.threadShells) {
    if (thread.environmentId !== input.localEnvironmentId) {
      continue;
    }

    const target = resolveTargetProject(thread.environmentId, thread.projectId);
    if (!target) {
      continue;
    }
    const { projectKey, project } = target;

    const threadHyprnav = filterHyprnavBindingsByScopes(project.hyprnav, THREAD_JOB_SCOPES);
    const threadClearBindings = filterScopedSlotsByScopes(
      input.clearBindingsByProjectKey.get(projectKey) ?? [],
      THREAD_JOB_SCOPES,
    );
    const threadClearNames = filterScopedSlotsByScopes(
      input.clearNamesByProjectKey.get(projectKey) ?? [],
      THREAD_JOB_SCOPES,
    );
    if (
      threadHyprnav.bindings.length === 0 &&
      threadClearBindings.length === 0 &&
      threadClearNames.length === 0 &&
      !input.hasPendingThreadCleanup?.({
        projectRoot: project.workspaceRoot,
        worktreePath: thread.worktreePath ?? null,
        threadId: thread.id,
        threadTitle: thread.title,
      })
    ) {
      continue;
    }
    addJob({
      projectKey,
      projectRoot: project.workspaceRoot,
      projectTitle: project.title,
      worktreePath: thread.worktreePath ?? null,
      threadId: thread.id,
      threadTitle: thread.title,
      hyprnav: threadHyprnav,
      clearBindings: threadClearBindings,
      clearNames: threadClearNames,
      lock: false,
    });
  }

  const knownWorktrees = new Map<
    string,
    { readonly projectKey: string; readonly worktreePath: string }
  >();
  for (const thread of input.threadShells) {
    if (thread.environmentId !== input.localEnvironmentId || !thread.worktreePath) continue;
    const target = resolveTargetProject(thread.environmentId, thread.projectId);
    if (!target || thread.worktreePath === target.project.workspaceRoot) continue;
    const { projectKey } = target;
    knownWorktrees.set(`${projectKey}\u0000${thread.worktreePath}`, {
      projectKey,
      worktreePath: thread.worktreePath,
    });
  }
  for (const { projectKey, worktreePath } of knownWorktrees.values()) {
    const project = localProjectsByKey.get(projectKey)!;
    addJob({
      projectKey,
      projectRoot: project.workspaceRoot,
      projectTitle: project.title,
      worktreePath,
      threadId: null,
      threadTitle: null,
      hyprnav: filterHyprnavBindingsByScopes(project.hyprnav, WORKTREE_JOB_SCOPES),
      clearBindings: filterScopedSlotsByScopes(
        input.clearBindingsByProjectKey.get(projectKey) ?? [],
        WORKTREE_JOB_SCOPES,
      ),
      clearNames: filterScopedSlotsByScopes(
        input.clearNamesByProjectKey.get(projectKey) ?? [],
        WORKTREE_JOB_SCOPES,
      ),
      lock: false,
    });
  }

  const activeThread = input.activeThread;
  if (activeThread && activeThread.environmentId === input.localEnvironmentId) {
    const target = resolveTargetProject(activeThread.environmentId, activeThread.projectId);
    if (target) {
      const { projectKey, project } = target;
      const threadHyprnav = filterHyprnavBindingsByScopes(project.hyprnav, THREAD_JOB_SCOPES);
      const threadClearBindings = filterScopedSlotsByScopes(
        input.clearBindingsByProjectKey.get(projectKey) ?? [],
        THREAD_JOB_SCOPES,
      );
      const threadClearNames = filterScopedSlotsByScopes(
        input.clearNamesByProjectKey.get(projectKey) ?? [],
        THREAD_JOB_SCOPES,
      );
      addJob({
        projectKey,
        projectRoot: project.workspaceRoot,
        projectTitle: project.title,
        worktreePath: activeThread.worktreePath ?? null,
        threadId: activeThread.id,
        threadTitle: activeThread.title,
        hyprnav: threadHyprnav,
        clearBindings: threadClearBindings,
        clearNames: threadClearNames,
        lock: true,
      });
    }
  }

  for (const [projectKey, project] of localProjectsByKey.entries()) {
    const baseClearBindings = filterScopedSlotsByScopes(
      input.clearBindingsByProjectKey.get(projectKey) ?? [],
      BASE_JOB_SCOPES,
    );
    const baseClearNames = filterScopedSlotsByScopes(
      input.clearNamesByProjectKey.get(projectKey) ?? [],
      BASE_JOB_SCOPES,
    );
    addJob({
      projectKey,
      projectRoot: project.workspaceRoot,
      projectTitle: project.title,
      worktreePath: null,
      threadId: null,
      threadTitle: null,
      hyprnav: filterHyprnavBindingsByScopes(project.hyprnav, BASE_JOB_SCOPES),
      clearBindings: baseClearBindings,
      clearNames: baseClearNames,
      lock: false,
    });
  }

  return [...jobsByKey.values()];
}
