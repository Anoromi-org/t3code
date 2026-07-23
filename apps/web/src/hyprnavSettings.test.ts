import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import {
  DEFAULT_PROJECT_HYPRNAV_SETTINGS,
  DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProjectHyprnavSyncJobs,
  computeClearedHyprnavBindingNames,
  computeRemovedHyprnavBindings,
  projectUsesDefaultHyprnav,
  projectHyprnavNeedsCorkdiffConnection,
  resolveProjectHyprnavSettings,
  validateProjectHyprnavSettings,
} from "./hyprnavSettings";
import type { Project, ThreadShell } from "./types";

const localEnvironmentId = EnvironmentId.make("environment-local");
const projectId = ProjectId.make("project-1");
const projectKey = scopedProjectKey(scopeProjectRef(localEnvironmentId, projectId));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: projectId,
    environmentId: localEnvironmentId,
    title: "Project",
    workspaceRoot: "/repo",
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-04-19T09:00:00.000Z",
    updatedAt: "2026-04-19T09:00:00.000Z",
    scripts: [],
    hyprnav: DEFAULT_PROJECT_HYPRNAV_SETTINGS,
    ...overrides,
  };
}

function makeResolvedProject(
  overrides: Partial<Project> = {},
): Project & { hyprnav: typeof DEFAULT_PROJECT_HYPRNAV_SETTINGS } {
  return makeProject({
    hyprnav: DEFAULT_PROJECT_HYPRNAV_SETTINGS,
    ...overrides,
  }) as Project & { hyprnav: typeof DEFAULT_PROJECT_HYPRNAV_SETTINGS };
}

function makeThreadShell(overrides: Partial<ThreadShell> = {}): ThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    latestTurn: null,
    createdAt: "2026-04-19T09:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    updatedAt: "2026-04-19T09:00:00.000Z",
    branch: null,
    worktreePath: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("hyprnavSettings", () => {
  it("validates duplicate project slots within the same scope only", () => {
    expect(
      validateProjectHyprnavSettings({
        bindings: [
          {
            id: "terminal",
            slot: 1,
            scope: "worktree",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            action: "worktree-terminal",
          },
          {
            id: "editor",
            slot: 1,
            scope: "worktree",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            action: "open-favorite-editor",
          },
          {
            id: "custom",
            slot: 1,
            scope: "project",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            action: "shell-command",
            command: "tmux",
          },
        ],
      }).duplicateScopedSlots,
    ).toEqual([{ scope: "worktree", slot: 1 }]);
  });

  it("validates empty shell commands", () => {
    expect(
      validateProjectHyprnavSettings({
        bindings: [
          {
            id: "custom",
            slot: 3,
            scope: "thread",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            action: "shell-command",
            command: "",
          },
        ],
      }).emptyShellCommandBindingIds,
    ).toEqual(["custom"]);
  });

  it("does not require commands for nothing bindings", () => {
    expect(
      validateProjectHyprnavSettings({
        bindings: [
          {
            id: "placeholder",
            slot: 3,
            scope: "thread",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            action: "nothing",
          },
        ],
      }).emptyShellCommandBindingIds,
    ).toEqual([]);
  });

  it("emits removed bindings when slot or scope ownership changes", () => {
    expect(
      computeRemovedHyprnavBindings(
        {
          bindings: [
            {
              id: "terminal",
              slot: 1,
              scope: "worktree",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "worktree-terminal",
            },
            {
              id: "editor",
              slot: 2,
              scope: "project",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "open-favorite-editor",
            },
            {
              id: "custom",
              slot: 8,
              scope: "thread",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "shell-command",
              command: "old",
            },
          ],
        },
        {
          bindings: [
            {
              id: "terminal",
              slot: 7,
              scope: "worktree",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "worktree-terminal",
            },
            {
              id: "editor",
              slot: 2,
              scope: "project",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "open-favorite-editor",
            },
            {
              id: "custom",
              slot: 8,
              scope: "project",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "shell-command",
              command: "new",
            },
          ],
        },
      ),
    ).toEqual([
      { scope: "thread", slot: 8 },
      { scope: "worktree", slot: 1 },
    ]);
  });

  it("does not emit removed bindings when only actions or commands change", () => {
    expect(
      computeRemovedHyprnavBindings(
        {
          bindings: [
            {
              id: "slot-1",
              slot: 1,
              scope: "worktree",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "shell-command",
              command: "old",
            },
          ],
        },
        {
          bindings: [
            {
              id: "slot-1",
              slot: 1,
              scope: "worktree",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "worktree-terminal",
            },
          ],
        },
      ),
    ).toEqual([]);
  });

  it("does not emit removed bindings when only workspace targeting changes", () => {
    expect(
      computeRemovedHyprnavBindings(
        {
          bindings: [
            {
              id: "slot-1",
              slot: 1,
              scope: "worktree",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "shell-command",
              command: "old",
            },
          ],
        },
        {
          bindings: [
            {
              id: "slot-1",
              slot: 1,
              scope: "worktree",
              workspace: { mode: "absolute", workspaceId: 13 },
              action: "shell-command",
              command: "old",
            },
          ],
        },
      ),
    ).toEqual([]);
  });

  it("detects slot names cleared without treating the binding as removed", () => {
    expect(
      computeClearedHyprnavBindingNames(
        {
          bindings: [
            {
              id: "slot-1",
              slot: 1,
              scope: "worktree",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              name: "API",
              action: "shell-command",
              command: "old",
            },
          ],
        },
        {
          bindings: [
            {
              id: "slot-1",
              slot: 1,
              scope: "worktree",
              workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
              action: "shell-command",
              command: "old",
            },
          ],
        },
      ),
    ).toEqual([{ scope: "worktree", slot: 1 }]);
  });

  it("builds project, worktree, and thread jobs for known local threads", () => {
    expect(
      buildProjectHyprnavSyncJobs({
        localEnvironmentId,
        projects: [makeResolvedProject()],
        knownProjects: [makeResolvedProject()],
        threadShells: [
          makeThreadShell({
            id: ThreadId.make("thread-1"),
            worktreePath: "/repo/worktrees/feature-a",
          }),
          makeThreadShell({
            id: ThreadId.make("thread-2"),
            worktreePath: "/repo/worktrees/feature-a",
          }),
        ],
        activeThread: {
          id: ThreadId.make("thread-2"),
          environmentId: localEnvironmentId,
          projectId,
          title: "Focused thread",
          worktreePath: "/repo/worktrees/feature-a",
        },
        clearBindingsByProjectKey: new Map([[projectKey, [{ scope: "thread", slot: 8 }]]]),
        clearNamesByProjectKey: new Map([[projectKey, [{ scope: "thread", slot: 2 }]]]),
      }),
    ).toEqual([
      {
        projectRoot: "/repo",
        worktreePath: "/repo/worktrees/feature-a",
        threadId: ThreadId.make("thread-1"),
        threadTitle: "Thread",
        hyprnav: {
          bindings: DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.filter(
            (binding) => binding.scope === "thread",
          ),
        },
        clearBindings: [{ scope: "thread", slot: 8 }],
        clearNames: [{ scope: "thread", slot: 2 }],
        lock: false,
      },
      {
        projectRoot: "/repo",
        worktreePath: "/repo/worktrees/feature-a",
        threadId: ThreadId.make("thread-2"),
        threadTitle: "Focused thread",
        hyprnav: {
          bindings: DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.filter(
            (binding) => binding.scope === "thread",
          ),
        },
        clearBindings: [{ scope: "thread", slot: 8 }],
        clearNames: [{ scope: "thread", slot: 2 }],
        lock: true,
      },
      {
        projectRoot: "/repo",
        worktreePath: "/repo/worktrees/feature-a",
        threadId: null,
        threadTitle: null,
        hyprnav: {
          bindings: DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.filter(
            (binding) => binding.scope !== "thread",
          ),
        },
        clearBindings: [],
        clearNames: [],
        lock: false,
      },
      {
        projectRoot: "/repo",
        worktreePath: null,
        threadId: null,
        threadTitle: null,
        hyprnav: {
          bindings: DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.filter(
            (binding) => binding.scope !== "thread",
          ),
        },
        clearBindings: [],
        clearNames: [],
        lock: false,
      },
    ]);
  });

  it("resolves threads from duplicate project records through the retained physical project", () => {
    const retainedProjectId = ProjectId.make("project-retained");
    const retainedProject = makeResolvedProject({ id: retainedProjectId });
    const retainedProjectKey = scopedProjectKey(
      scopeProjectRef(localEnvironmentId, retainedProjectId),
    );
    const duplicateProject = makeProject({ id: ProjectId.make("project-duplicate") });
    const duplicateThread = makeThreadShell({
      id: ThreadId.make("duplicate-thread"),
      projectId: duplicateProject.id,
      worktreePath: "/repo/worktrees/duplicate",
    });

    const jobs = buildProjectHyprnavSyncJobs({
      localEnvironmentId,
      projects: [retainedProject],
      knownProjects: [duplicateProject, retainedProject],
      threadShells: [duplicateThread],
      activeThread: duplicateThread,
      clearBindingsByProjectKey: new Map([
        [
          retainedProjectKey,
          [
            { scope: "worktree", slot: 6 },
            { scope: "thread", slot: 8 },
          ],
        ],
      ]),
      clearNamesByProjectKey: new Map(),
    });

    expect(jobs).toContainEqual(
      expect.objectContaining({
        projectRoot: "/repo",
        worktreePath: "/repo/worktrees/duplicate",
        threadId: duplicateThread.id,
        clearBindings: [{ scope: "thread", slot: 8 }],
        lock: true,
      }),
    );
    expect(jobs).toContainEqual(
      expect.objectContaining({
        projectRoot: "/repo",
        worktreePath: "/repo/worktrees/duplicate",
        threadId: null,
        clearBindings: [{ scope: "worktree", slot: 6 }],
      }),
    );
  });

  it("publishes base bindings and cleanup for every distinct known non-root worktree", () => {
    const jobs = buildProjectHyprnavSyncJobs({
      localEnvironmentId,
      projects: [makeResolvedProject()],
      knownProjects: [makeResolvedProject()],
      threadShells: [
        makeThreadShell({ id: ThreadId.make("one"), worktreePath: "/repo/worktrees/one" }),
        makeThreadShell({ id: ThreadId.make("two"), worktreePath: "/repo/worktrees/two" }),
        makeThreadShell({ id: ThreadId.make("duplicate"), worktreePath: "/repo/worktrees/one" }),
      ],
      activeThread: null,
      clearBindingsByProjectKey: new Map([[projectKey, [{ scope: "worktree", slot: 9 }]]]),
      clearNamesByProjectKey: new Map([[projectKey, [{ scope: "worktree", slot: 7 }]]]),
    });

    expect(
      jobs
        .filter((job) => job.threadId === null && job.worktreePath !== null)
        .map((job) => ({
          worktreePath: job.worktreePath,
          clearBindings: job.clearBindings,
          clearNames: job.clearNames,
        })),
    ).toEqual([
      {
        worktreePath: "/repo/worktrees/one",
        clearBindings: [{ scope: "worktree", slot: 9 }],
        clearNames: [{ scope: "worktree", slot: 7 }],
      },
      {
        worktreePath: "/repo/worktrees/two",
        clearBindings: [{ scope: "worktree", slot: 9 }],
        clearNames: [{ scope: "worktree", slot: 7 }],
      },
    ]);
  });

  it("falls back to a project-root job when no local threads are known", () => {
    expect(
      buildProjectHyprnavSyncJobs({
        localEnvironmentId,
        projects: [makeResolvedProject()],
        knownProjects: [makeResolvedProject()],
        threadShells: [],
        activeThread: null,
        clearBindingsByProjectKey: new Map([[projectKey, [{ scope: "project", slot: 2 }]]]),
        clearNamesByProjectKey: new Map([[projectKey, [{ scope: "project", slot: 5 }]]]),
      }),
    ).toEqual([
      {
        projectRoot: "/repo",
        worktreePath: null,
        threadId: null,
        threadTitle: null,
        hyprnav: {
          bindings: DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.filter(
            (binding) => binding.scope !== "thread",
          ),
        },
        clearBindings: [{ scope: "project", slot: 2 }],
        clearNames: [{ scope: "project", slot: 5 }],
        lock: false,
      },
    ]);
  });

  it("detects when Hyprnav settings need a Corkdiff connection", () => {
    expect(projectHyprnavNeedsCorkdiffConnection(DEFAULT_PROJECT_HYPRNAV_SETTINGS)).toBe(true);
    expect(
      projectHyprnavNeedsCorkdiffConnection({
        bindings: [
          {
            id: "custom",
            slot: 5,
            scope: "project",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            action: "shell-command",
            command: "tmux",
          },
        ],
      }),
    ).toBe(false);
  });

  it("resolves project defaults when the override is null", () => {
    expect(resolveProjectHyprnavSettings(null, DEFAULT_PROJECT_HYPRNAV_SETTINGS)).toEqual(
      DEFAULT_PROJECT_HYPRNAV_SETTINGS,
    );
    expect(projectUsesDefaultHyprnav(null)).toBe(true);
    expect(projectUsesDefaultHyprnav(DEFAULT_PROJECT_HYPRNAV_SETTINGS)).toBe(false);
  });

  it("prefers the project override over global Hyprnav defaults", () => {
    const defaults = {
      bindings: [
        {
          id: "terminal",
          slot: 1,
          scope: "worktree",
          workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
          action: "worktree-terminal",
        },
      ],
    } as const;
    const override = {
      bindings: [
        {
          id: "terminal",
          slot: 1,
          scope: "worktree",
          workspace: { mode: "absolute", workspaceId: 21 },
          action: "worktree-terminal",
        },
      ],
    } as const;

    expect(resolveProjectHyprnavSettings(override, defaults)).toEqual(override);
  });
});
