import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, ProjectId, type ProjectHyprnavSettings } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { derivePhysicalProjectKey } from "../../logicalProject";
import {
  type HyprnavPublicationHistory,
  recordActiveHyprnavPublication,
} from "../../hyprnavRuntime";
import {
  applyProjectHyprnavGroupChange,
  buildHyprnavPublicationRequests,
  hyprnavDraftFromSettings,
  parseHyprnavDraft,
  publishSettingsChange,
  resolveProjectHyprnavGroup,
  resolveProjectHyprnavNextOverride,
  selectInheritedLocalHyprnavProjects,
  updateGroupedProjectHyprnavMode,
  createProjectHyprnavModeCoordinator,
  transitionProjectHyprnavMode,
} from "./ProjectHyprnavSettingsPanel";
import type { Project } from "../../types";

const SETTINGS: ProjectHyprnavSettings = {
  bindings: [
    {
      id: "terminal",
      slot: 1,
      scope: "worktree",
      workspace: { mode: "managed" },
      name: "Terminal",
      action: "worktree-terminal",
    },
    {
      id: "command",
      slot: 4,
      scope: "thread",
      workspace: { mode: "absolute", workspaceId: 7 },
      action: "shell-command",
      command: "notify-send ready",
    },
  ],
};

function makeProject(input: {
  environmentId: string;
  projectId: string;
  workspaceRoot: string;
  hyprnav?: ProjectHyprnavSettings | null;
}): Project {
  return {
    id: ProjectId.make(input.projectId),
    environmentId: EnvironmentId.make(input.environmentId),
    title: input.projectId,
    workspaceRoot: input.workspaceRoot,
    repositoryIdentity: {
      canonicalKey: "github.com/t3tools/t3code",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/t3tools/t3code.git",
      },
    },
    defaultModelSelection: null,
    scripts: [],
    ...(input.hyprnav !== undefined ? { hyprnav: input.hyprnav } : {}),
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

describe("ProjectHyprnavSettingsPanel logic", () => {
  it("round trips every editable binding field", () => {
    const draft = hyprnavDraftFromSettings(SETTINGS);
    expect(draft[1]).toMatchObject({
      slot: "4",
      scope: "thread",
      workspaceMode: "absolute",
      workspaceId: "7",
      action: "shell-command",
      command: "notify-send ready",
    });
    expect(parseHyprnavDraft(draft)).toEqual({ settings: SETTINGS, message: null });
  });

  it("rejects duplicate slots only within the same scope", () => {
    const draft = hyprnavDraftFromSettings(SETTINGS);
    expect(
      parseHyprnavDraft([...draft, { ...draft[0]!, id: "duplicate", action: "nothing" }]).message,
    ).toBe("Each scope can use a slot only once.");

    expect(
      parseHyprnavDraft([
        ...draft,
        { ...draft[0]!, id: "project-slot", scope: "project", action: "nothing" },
      ]).message,
    ).toBeNull();
  });

  it("requires valid absolute workspaces and shell commands", () => {
    const [terminal, command] = hyprnavDraftFromSettings(SETTINGS);
    expect(
      parseHyprnavDraft([{ ...terminal!, workspaceMode: "absolute", workspaceId: "0" }]).message,
    ).toContain("positive workspace");
    expect(parseHyprnavDraft([{ ...command!, command: " " }]).message).toContain("need a command");
  });

  it("rejects slot and workspace integers outside the persisted safe range", () => {
    const [terminal] = hyprnavDraftFromSettings(SETTINGS);
    const unsafe = String(Number.MAX_SAFE_INTEGER + 1);
    expect(parseHyprnavDraft([{ ...terminal!, slot: unsafe }]).message).toContain(
      "positive whole number",
    );
    expect(
      parseHyprnavDraft([{ ...terminal!, workspaceMode: "absolute", workspaceId: unsafe }]).message,
    ).toContain("positive workspace");
  });

  it("rejects binding names longer than the persisted contract allows", () => {
    const [binding] = hyprnavDraftFromSettings(SETTINGS);
    expect(parseHyprnavDraft([{ ...binding!, name: "x".repeat(256) }]).message).toBe(
      "Binding names must be 255 characters or fewer.",
    );
    expect(parseHyprnavDraft([{ ...binding!, name: "x".repeat(255) }]).message).toBeNull();
  });

  it("persists inherited null when a project matches the global defaults", () => {
    expect(
      resolveProjectHyprnavNextOverride({
        parsedSettings: SETTINGS,
        defaultProjectHyprnavSettings: SETTINGS,
        forceInherited: false,
      }),
    ).toBeNull();
    expect(
      resolveProjectHyprnavNextOverride({
        parsedSettings: { bindings: [] },
        defaultProjectHyprnavSettings: SETTINGS,
        forceInherited: false,
      }),
    ).toEqual({ bindings: [] });
  });

  it("applies same-mode settings to every logical-project member and honors its default", () => {
    const primary = makeProject({
      environmentId: "primary",
      projectId: "primary-project",
      workspaceRoot: "/repo",
      hyprnav: SETTINGS,
    });
    const remote = makeProject({
      environmentId: "remote",
      projectId: "remote-project",
      workspaceRoot: "/srv/repo",
      hyprnav: { bindings: [] },
    });
    const groupingSettings = {
      sidebarProjectGroupingMode: "repository" as const,
      sidebarProjectGroupingOverrides: {},
    };
    const logicalProjectKey = "github.com/t3tools/t3code";
    const group = resolveProjectHyprnavGroup({
      selectedProject: remote,
      projects: [primary, remote],
      groupingSettings,
      stateByLogicalProjectKey: {
        [logicalProjectKey]: {
          mode: "same",
          defaultProjectKey: scopedProjectKey(scopeProjectRef(primary.environmentId, primary.id)),
        },
      },
      primaryEnvironmentId: primary.environmentId,
    });

    expect(group.members).toEqual([primary, remote]);
    expect(group.settingsProject).toBe(primary);
  });

  it("keeps grouped project settings isolated in separate mode", () => {
    const primary = makeProject({
      environmentId: "primary",
      projectId: "primary-project",
      workspaceRoot: "/repo",
    });
    const remote = makeProject({
      environmentId: "remote",
      projectId: "remote-project",
      workspaceRoot: "/srv/repo",
    });
    const group = resolveProjectHyprnavGroup({
      selectedProject: remote,
      projects: [primary, remote],
      groupingSettings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      stateByLogicalProjectKey: {
        "github.com/t3tools/t3code": {
          mode: "separate",
          defaultProjectKey: scopedProjectKey(scopeProjectRef(primary.environmentId, primary.id)),
        },
      },
      primaryEnvironmentId: primary.environmentId,
    });

    expect(group.members).toEqual([remote]);
    expect(group.settingsProject).toBe(remote);
    expect(group.sharedSettingsProject).toBe(primary);
  });

  it("chooses the primary local member as the stable shared settings source", () => {
    const primary = makeProject({
      environmentId: "primary",
      projectId: "primary-project",
      workspaceRoot: "/repo",
      hyprnav: SETTINGS,
    });
    const remote = makeProject({
      environmentId: "remote",
      projectId: "remote-project",
      workspaceRoot: "/srv/repo",
      hyprnav: { bindings: [] },
    });
    const group = resolveProjectHyprnavGroup({
      selectedProject: remote,
      projects: [remote, primary],
      groupingSettings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      stateByLogicalProjectKey: {
        "github.com/t3tools/t3code": { mode: "same" },
      },
      primaryEnvironmentId: primary.environmentId,
    });

    expect(group.settingsProject).toBe(primary);
  });

  it("defaults a group with divergent persisted settings to separate mode", () => {
    const primary = makeProject({
      environmentId: "primary",
      projectId: "primary-project",
      workspaceRoot: "/repo",
      hyprnav: SETTINGS,
    });
    const remote = makeProject({
      environmentId: "remote",
      projectId: "remote-project",
      workspaceRoot: "/srv/repo",
      hyprnav: { bindings: [] },
    });

    const group = resolveProjectHyprnavGroup({
      selectedProject: remote,
      projects: [primary, remote],
      groupingSettings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      stateByLogicalProjectKey: {},
      primaryEnvironmentId: primary.environmentId,
    });

    expect(group.mode).toBe("separate");
    expect(group.members).toEqual([remote]);
    expect(group.settingsProject).toBe(remote);
  });

  it("excludes stale physical-project duplicates from grouped save scope", () => {
    const stale = {
      ...makeProject({
        environmentId: "primary",
        projectId: "stale-project",
        workspaceRoot: "/repo",
        hyprnav: { bindings: [] },
      }),
      updatedAt: "2026-07-10T00:00:00.000Z",
    };
    const current = {
      ...makeProject({
        environmentId: "primary",
        projectId: "current-project",
        workspaceRoot: "/repo",
        hyprnav: SETTINGS,
      }),
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const remote = makeProject({
      environmentId: "remote",
      projectId: "remote-project",
      workspaceRoot: "/srv/repo",
      hyprnav: SETTINGS,
    });

    const group = resolveProjectHyprnavGroup({
      selectedProject: current,
      projects: [stale, current, remote],
      groupingSettings: {
        sidebarProjectGroupingMode: "repository",
        sidebarProjectGroupingOverrides: {},
      },
      stateByLogicalProjectKey: {
        "github.com/t3tools/t3code": { mode: "same" },
      },
      primaryEnvironmentId: current.environmentId,
    });

    expect(group.groupedMembers).toEqual([current, remote]);
    expect(group.members).toEqual([current, remote]);
    expect(group.groupedMembers).not.toContain(stale);
  });

  it("deduplicates physical projects before selecting inherited default targets", () => {
    const staleInherited = {
      ...makeProject({
        environmentId: "primary",
        projectId: "stale-project",
        workspaceRoot: "/repo",
        hyprnav: null,
      }),
      updatedAt: "2026-07-10T00:00:00.000Z",
    };
    const currentOverride = {
      ...makeProject({
        environmentId: "primary",
        projectId: "current-project",
        workspaceRoot: "/repo",
        hyprnav: SETTINGS,
      }),
      updatedAt: "2026-07-12T00:00:00.000Z",
    };

    expect(
      selectInheritedLocalHyprnavProjects({
        projects: [staleInherited, currentOverride],
        groupingSettings: {
          sidebarProjectGroupingMode: "repository",
          sidebarProjectGroupingOverrides: {},
        },
        primaryEnvironmentId: currentOverride.environmentId,
      }),
    ).toEqual([]);
  });

  it("persists an explicit grouped-project editing mode", () => {
    const primary = makeProject({
      environmentId: "primary",
      projectId: "primary-project",
      workspaceRoot: "/repo",
    });
    const logicalProjectKey = "github.com/t3tools/t3code";

    expect(
      updateGroupedProjectHyprnavMode({
        stateByLogicalProjectKey: {},
        logicalProjectKey,
        mode: "separate",
        sharedSettingsProject: primary,
      }),
    ).toEqual({ [logicalProjectKey]: { mode: "separate" } });
    expect(
      updateGroupedProjectHyprnavMode({
        stateByLogicalProjectKey: {},
        logicalProjectKey,
        mode: "same",
        sharedSettingsProject: primary,
      }),
    ).toEqual({
      [logicalProjectKey]: {
        mode: "same",
        defaultProjectKey: derivePhysicalProjectKey(primary),
      },
    });
  });

  it("waits for an editing-mode transition before resolving save scope", async () => {
    const coordinator = createProjectHyprnavModeCoordinator();
    let releasePersistence: (() => void) | undefined;
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const modeChange = coordinator.change("separate", () => persistence);
    let resolvedMode: string | null = null;
    const beforeSave = coordinator.beforeSave("same").then((mode) => {
      resolvedMode = mode;
    });

    await Promise.resolve();
    expect(resolvedMode).toBeNull();
    releasePersistence?.();
    await Promise.all([modeChange, beforeSave]);
    expect(resolvedMode).toBe("separate");
  });

  it("synchronizes grouped settings before persisting same mode", async () => {
    const calls: string[] = [];
    await transitionProjectHyprnavMode({
      mode: "same",
      synchronizeSameSettings: async () => {
        calls.push("synchronize");
      },
      persistMode: async () => {
        calls.push("persist-mode");
      },
      rollbackSameSettings: async () => {
        calls.push("rollback");
      },
    });
    expect(calls).toEqual(["synchronize", "persist-mode"]);
  });

  it("does not persist same mode when grouped synchronization fails", async () => {
    let persistModeCalls = 0;
    await expect(
      transitionProjectHyprnavMode({
        mode: "same",
        synchronizeSameSettings: async () => {
          throw new Error("remote unavailable");
        },
        persistMode: async () => {
          persistModeCalls += 1;
        },
        rollbackSameSettings: async () => {},
      }),
    ).rejects.toThrow("remote unavailable");
    expect(persistModeCalls).toBe(0);
  });

  it("restores grouped settings when same-mode persistence fails", async () => {
    const calls: string[] = [];
    await expect(
      transitionProjectHyprnavMode({
        mode: "same",
        synchronizeSameSettings: async () => {
          calls.push("synchronize");
        },
        persistMode: async () => {
          calls.push("persist-mode");
          throw new Error("disk full");
        },
        rollbackSameSettings: async () => {
          calls.push("rollback");
        },
      }),
    ).rejects.toThrow("disk full");
    expect(calls).toEqual(["synchronize", "persist-mode", "rollback"]);
  });

  it("surfaces a grouped-settings rollback failure with the persistence error", async () => {
    await expect(
      transitionProjectHyprnavMode({
        mode: "same",
        synchronizeSameSettings: async () => {},
        persistMode: async () => {
          throw new Error("disk full");
        },
        rollbackSameSettings: async () => {
          throw new Error("remote unavailable");
        },
      }),
    ).rejects.toThrow(
      "disk full Could not restore the previous grouped project settings: remote unavailable",
    );
  });

  it("updates remote grouped projects before the primary project", async () => {
    const primary = makeProject({
      environmentId: "primary",
      projectId: "primary-project",
      workspaceRoot: "/repo",
    });
    const remote = makeProject({
      environmentId: "remote",
      projectId: "remote-project",
      workspaceRoot: "/srv/repo",
    });
    const calls: string[] = [];

    const result = await applyProjectHyprnavGroupChange({
      members: [primary, remote],
      primaryEnvironmentId: primary.environmentId,
      nextHyprnav: SETTINGS,
      update: async (member) => {
        calls.push(member.environmentId);
        return member === remote
          ? { ok: false, error: new Error("environment unavailable") }
          : { ok: true };
      },
    });

    expect(result).toMatchObject({ ok: false });
    expect(calls).toEqual(["remote"]);
  });

  it("rolls back successful grouped-project updates after a later failure", async () => {
    const primary = makeProject({
      environmentId: "primary",
      projectId: "primary-project",
      workspaceRoot: "/repo",
      hyprnav: null,
    });
    const remoteA = makeProject({
      environmentId: "remote-a",
      projectId: "remote-a-project",
      workspaceRoot: "/srv/a",
      hyprnav: { bindings: [] },
    });
    const remoteB = makeProject({
      environmentId: "remote-b",
      projectId: "remote-b-project",
      workspaceRoot: "/srv/b",
      hyprnav: null,
    });
    const calls: Array<{ environmentId: string; hyprnav: ProjectHyprnavSettings | null }> = [];

    const result = await applyProjectHyprnavGroupChange({
      members: [primary, remoteB, remoteA],
      primaryEnvironmentId: primary.environmentId,
      nextHyprnav: SETTINGS,
      update: async (member, hyprnav) => {
        calls.push({ environmentId: member.environmentId, hyprnav });
        return member === remoteB
          ? { ok: false, error: new Error("environment unavailable") }
          : { ok: true };
      },
    });

    expect(result).toMatchObject({ ok: false });
    expect(calls).toEqual([
      { environmentId: "remote-a", hyprnav: SETTINGS },
      { environmentId: "remote-b", hyprnav: SETTINGS },
      { environmentId: "remote-a", hyprnav: { bindings: [] } },
    ]);
  });

  it("publishes removed slots and cleared names after a durable settings change", () => {
    const environmentId = EnvironmentId.make("primary");
    const projectId = ProjectId.make("project-1");
    const previous: ProjectHyprnavSettings = {
      bindings: [
        {
          id: "removed",
          slot: 1,
          scope: "project",
          workspace: { mode: "managed" },
          action: "nothing",
        },
        {
          id: "renamed",
          slot: 2,
          scope: "worktree",
          workspace: { mode: "managed" },
          name: "Old name",
          action: "nothing",
        },
      ],
    };
    const next: ProjectHyprnavSettings = {
      bindings: [
        {
          id: "renamed",
          slot: 2,
          scope: "worktree",
          workspace: { mode: "managed" },
          action: "nothing",
        },
      ],
    };
    const requests = buildHyprnavPublicationRequests({
      localEnvironmentId: environmentId,
      knownProjects: [],
      projects: [
        {
          id: projectId,
          environmentId,
          title: "Project",
          workspaceRoot: "/repo",
          repositoryIdentity: null,
          defaultModelSelection: null,
          scripts: [],
          hyprnav: previous,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
          nextHyprnav: next,
        },
      ],
      threadShells: [],
      previousSettingsByProjectKey: new Map([
        [scopedProjectKey(scopeProjectRef(environmentId, projectId)), previous],
      ]),
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      projectRoot: "/repo",
      clearBindings: [{ scope: "project", slot: 1 }],
      clearNames: [{ scope: "worktree", slot: 2 }],
    });
  });

  it("cleans up both durable and possibly-applied settings after a failed publication", () => {
    const environmentId = EnvironmentId.make("primary");
    const projectId = ProjectId.make("project-1");
    const possiblyApplied: ProjectHyprnavSettings = {
      bindings: [
        {
          id: "old-runtime",
          slot: 1,
          scope: "worktree",
          workspace: { mode: "managed" },
          action: "nothing",
        },
      ],
    };
    const durable: ProjectHyprnavSettings = {
      bindings: [
        {
          id: "durable",
          slot: 2,
          scope: "worktree",
          workspace: { mode: "managed" },
          action: "nothing",
        },
      ],
    };
    const next: ProjectHyprnavSettings = {
      bindings: [
        {
          id: "next",
          slot: 3,
          scope: "worktree",
          workspace: { mode: "managed" },
          action: "nothing",
        },
      ],
    };
    const history: HyprnavPublicationHistory = new Map();
    recordActiveHyprnavPublication({
      history,
      target: {
        projectRoot: "/repo",
        worktreePath: null,
        threadId: null,
        threadTitle: null,
      },
      settings: possiblyApplied,
      appliedScopes: ["worktree"],
    });

    const project = makeProject({
      environmentId,
      projectId,
      workspaceRoot: "/repo",
      hyprnav: durable,
    });
    const requests = buildHyprnavPublicationRequests({
      localEnvironmentId: environmentId,
      knownProjects: [project],
      projects: [{ ...project, nextHyprnav: next }],
      threadShells: [],
      previousSettingsByProjectKey: new Map([
        [scopedProjectKey(scopeProjectRef(environmentId, projectId)), durable],
      ]),
      publicationHistory: history,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.clearBindings).toEqual([
      { scope: "worktree", slot: 2 },
      { scope: "worktree", slot: 1 },
    ]);
  });

  it("reports publication exceptions as saved but not applied", async () => {
    const environmentId = EnvironmentId.make("primary");
    const projectId = ProjectId.make("project-1");
    await expect(
      publishSettingsChange({
        localEnvironmentId: environmentId,
        knownProjects: [],
        projects: [
          {
            id: projectId,
            environmentId,
            title: "Project",
            workspaceRoot: "/repo",
            repositoryIdentity: null,
            defaultModelSelection: null,
            scripts: [],
            hyprnav: SETTINGS,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
            nextHyprnav: SETTINGS,
          },
        ],
        threadShells: [],
        previousSettingsByProjectKey: new Map([
          [scopedProjectKey(scopeProjectRef(environmentId, projectId)), SETTINGS],
        ]),
        availableEditors: [],
        publish: async () => {
          throw new Error("ticket issuance failed");
        },
      }),
    ).resolves.toBe("Saved, but Hyprnav was not applied. ticket issuance failed");
  });

  it("does not report synchronization after partial scopes exhaust retries", async () => {
    const environmentId = EnvironmentId.make("primary");
    const project = makeProject({
      environmentId,
      projectId: "project-1",
      workspaceRoot: "/repo",
      hyprnav: SETTINGS,
    });
    await expect(
      publishSettingsChange({
        localEnvironmentId: environmentId,
        knownProjects: [project],
        projects: [{ ...project, nextHyprnav: SETTINGS }],
        threadShells: [],
        previousSettingsByProjectKey: new Map([
          [scopedProjectKey(scopeProjectRef(environmentId, project.id)), SETTINGS],
        ]),
        availableEditors: [],
        publish: async () => ({
          status: "error",
          message: "Hyprnav did not apply every requested scope.",
          appliedScopes: ["project"],
        }),
      }),
    ).resolves.toBe(
      "Saved, but Hyprnav was not applied. Hyprnav did not apply every requested scope.",
    );
  });

  it("does not report runtime synchronization for a remote-only save", async () => {
    const localEnvironmentId = EnvironmentId.make("primary");
    const remote = makeProject({
      environmentId: "remote",
      projectId: "remote-project",
      workspaceRoot: "/srv/repo",
      hyprnav: SETTINGS,
    });
    let publishCalls = 0;

    await expect(
      publishSettingsChange({
        localEnvironmentId,
        knownProjects: [remote],
        projects: [{ ...remote, nextHyprnav: SETTINGS }],
        threadShells: [],
        previousSettingsByProjectKey: new Map(),
        availableEditors: [],
        publish: async () => {
          publishCalls += 1;
          return { status: "ok", message: "Applied." };
        },
      }),
    ).resolves.toBe("Saved. Runtime synchronization is limited to the primary local environment.");
    expect(publishCalls).toBe(0);
  });
});
