import { describe, expect, it } from "vite-plus/test";

import { buildProjectThreadWorkspaceBootstrap } from "./projectThreadWorkspace";

describe("buildProjectThreadWorkspaceBootstrap", () => {
  it("asks the server to generate the final branch before creating a worktree", () => {
    const bootstrap = buildProjectThreadWorkspaceBootstrap({
      projectCwd: "/repo",
      workspaceMode: "worktree",
      branch: "main",
      worktreePath: null,
      startFromOrigin: false,
      supportsServerBranchGeneration: true,
    });

    expect(bootstrap.prepareWorktree).toEqual({
      projectCwd: "/repo",
      baseBranch: "main",
      generateBranch: true,
    });
  });

  it("does not prepare a worktree for local threads", () => {
    const bootstrap = buildProjectThreadWorkspaceBootstrap({
      projectCwd: "/repo",
      workspaceMode: "local",
      branch: "main",
      worktreePath: null,
      startFromOrigin: false,
      supportsServerBranchGeneration: true,
    });

    expect(bootstrap).toEqual({});
  });

  it("falls back to a legacy temporary branch for older servers", () => {
    const bootstrap = buildProjectThreadWorkspaceBootstrap({
      projectCwd: "/repo",
      workspaceMode: "worktree",
      branch: "main",
      worktreePath: null,
      startFromOrigin: false,
      supportsServerBranchGeneration: false,
      legacyBranchName: "t3code/12345678",
    });

    expect(bootstrap.prepareWorktree).toEqual({
      projectCwd: "/repo",
      baseBranch: "main",
      branch: "t3code/12345678",
    });
  });

  it("reuses an already selected worktree without preparing another one", () => {
    const bootstrap = buildProjectThreadWorkspaceBootstrap({
      projectCwd: "/repo",
      workspaceMode: "worktree",
      branch: "feature/existing",
      worktreePath: "/worktrees/feature-existing",
      startFromOrigin: false,
      supportsServerBranchGeneration: true,
    });

    expect(bootstrap).toEqual({});
  });
});
