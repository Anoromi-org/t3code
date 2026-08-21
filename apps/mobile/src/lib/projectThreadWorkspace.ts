export function buildProjectThreadWorkspaceBootstrap(input: {
  projectCwd: string;
  workspaceMode: "local" | "worktree";
  branch: string | null;
  worktreePath: string | null;
  startFromOrigin: boolean;
  supportsServerBranchGeneration: boolean;
  legacyBranchName?: string;
}) {
  if (input.workspaceMode === "local" || input.worktreePath !== null) {
    return {};
  }

  return {
    prepareWorktree: {
      projectCwd: input.projectCwd,
      baseBranch: input.branch!,
      ...(input.supportsServerBranchGeneration
        ? { generateBranch: true as const }
        : { branch: input.legacyBranchName! }),
      ...(input.startFromOrigin ? { startFromOrigin: true as const } : {}),
    },
    runSetupScript: true as const,
  };
}
