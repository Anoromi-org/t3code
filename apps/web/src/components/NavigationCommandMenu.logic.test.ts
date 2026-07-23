import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import {
  buildNavigationCommandResults,
  resolveDraftProjectKeys,
  resolveProjectDraftId,
} from "./NavigationCommandMenu.logic";

const project = {
  id: "project-nav",
  environmentId: "environment-nav",
  title: "Navigation project",
  workspaceRoot: "/workspace/navigation",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
} as EnvironmentProject;

const thread = {
  id: "thread-nav",
  environmentId: project.environmentId,
  projectId: project.id,
  title: "Fix command hotkeys",
  branch: "feature/hotkeys",
  worktreePath: null,
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  latestUserMessageAt: null,
  archivedAt: null,
} as EnvironmentThreadShell;

describe("buildNavigationCommandResults", () => {
  it("shows recent threads when the query is empty", () => {
    expect(
      buildNavigationCommandResults({ query: "", projects: [project], threads: [thread] }),
    ).toMatchObject([{ type: "thread", title: "Fix command hotkeys" }]);
  });

  it("labels every grouped sibling when their logical project has a draft", () => {
    const repositoryIdentity = {
      canonicalKey: "github.com:t3tools/t3code",
      displayName: "t3code",
      name: "t3code",
      rootPath: "/workspace/t3code",
    };
    const sibling = {
      ...project,
      id: "project-nav-sibling",
      workspaceRoot: "/workspace/t3code-sibling",
      repositoryIdentity,
    } as EnvironmentProject;
    const groupedProject = {
      ...project,
      workspaceRoot: "/workspace/t3code",
      repositoryIdentity,
    } as EnvironmentProject;

    expect(
      resolveDraftProjectKeys({
        projects: [groupedProject, sibling],
        draftLogicalProjectKeys: new Set([repositoryIdentity.canonicalKey]),
        projectGroupingSettings: {
          sidebarProjectGroupingMode: "repository",
          sidebarProjectGroupingOverrides: {},
        },
      }),
    ).toEqual(
      new Set([
        scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        scopedProjectKey(scopeProjectRef(sibling.environmentId, sibling.id)),
      ]),
    );
  });

  it("resolves a grouped project's mapped draft regardless of draft content", () => {
    const repositoryIdentity = {
      canonicalKey: "github.com:t3tools/t3code",
      displayName: "t3code",
      name: "t3code",
      rootPath: "/workspace/t3code",
    };
    const sibling = {
      ...project,
      id: "project-nav-sibling",
      repositoryIdentity,
    } as EnvironmentProject;
    const draftId = "invested-draft-id";

    expect(
      resolveProjectDraftId({
        projectRef: scopeProjectRef(sibling.environmentId, sibling.id),
        projects: [{ ...project, repositoryIdentity } as EnvironmentProject, sibling],
        projectGroupingSettings: {
          sidebarProjectGroupingMode: "repository",
          sidebarProjectGroupingOverrides: {},
        },
        getDraftIdByLogicalProjectKey: (logicalProjectKey) =>
          logicalProjectKey === repositoryIdentity.canonicalKey ? draftId : null,
      }),
    ).toEqual(draftId);
  });

  it("ignores a stale logical-project draft mapping", () => {
    expect(
      resolveProjectDraftId({
        projectRef: scopeProjectRef(project.environmentId, project.id),
        projects: [project],
        projectGroupingSettings: {
          sidebarProjectGroupingMode: "repository",
          sidebarProjectGroupingOverrides: {},
        },
        getDraftIdByLogicalProjectKey: () => null,
      }),
    ).toBeNull();
  });

  it("searches threads and projects and preserves scoped draft identity", () => {
    const draftProjectKeys = new Set([
      scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
    ]);
    const results = buildNavigationCommandResults({
      query: "navigation",
      projects: [project],
      threads: [thread],
      draftProjectKeys,
    });

    expect(results).toContainEqual(
      expect.objectContaining({
        type: "project",
        title: "Navigation project",
        hasDraft: true,
        ref: { environmentId: "environment-nav", projectId: "project-nav" },
      }),
    );
  });

  it("matches thread branch names", () => {
    expect(
      buildNavigationCommandResults({ query: "feature/", projects: [project], threads: [thread] }),
    ).toMatchObject([{ type: "thread", title: "Fix command hotkeys" }]);
  });

  it("ranks an active project before an equal-score project without activity", () => {
    const inactiveProject = {
      ...project,
      id: "project-nav-inactive",
      title: project.title,
      workspaceRoot: "/workspace/navigation-inactive",
    } as EnvironmentProject;
    const projectResults = buildNavigationCommandResults({
      query: "Navigation project",
      projects: [inactiveProject, project],
      threads: [thread],
    }).filter((item) => item.type === "project");

    expect(projectResults.map((item) => item.ref.projectId)).toEqual([
      project.id,
      inactiveProject.id,
    ]);
  });

  it("excludes archived threads from recents and search", () => {
    const archivedThread = { ...thread, archivedAt: "2026-07-12T00:00:00.000Z" };
    expect(
      buildNavigationCommandResults({
        query: "hotkeys",
        projects: [project],
        threads: [archivedThread],
      }),
    ).toEqual([]);
  });
});
