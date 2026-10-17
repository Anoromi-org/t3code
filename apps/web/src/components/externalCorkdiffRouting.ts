interface ExternalCorkdiffOpenInput {
  readonly cwd: string;
  readonly threadId: string;
}

interface RouteDiffShortcutInput {
  readonly activeEnvironmentId: string | null | undefined;
  readonly activeThreadId: string | null | undefined;
  readonly activeWorkspaceRoot: string | null | undefined;
  readonly isServerThread: boolean;
  readonly openExternalCorkdiff:
    | ((input: ExternalCorkdiffOpenInput) => Promise<unknown>)
    | undefined;
  readonly openInApp: () => void;
  readonly primaryEnvironmentId: string | null;
  readonly reportExternalError: (description: string) => void;
  readonly toggleInApp: () => void;
}

export async function routeDiffShortcut(input: RouteDiffShortcutInput): Promise<void> {
  if (
    input.openExternalCorkdiff === undefined ||
    !input.isServerThread ||
    !input.activeThreadId ||
    input.primaryEnvironmentId === null ||
    input.activeEnvironmentId !== input.primaryEnvironmentId
  ) {
    input.toggleInApp();
    return;
  }

  if (!input.activeWorkspaceRoot) {
    input.reportExternalError("The active thread does not have a working directory.");
    input.openInApp();
    return;
  }

  try {
    await input.openExternalCorkdiff({
      cwd: input.activeWorkspaceRoot,
      threadId: input.activeThreadId,
    });
  } catch (error) {
    input.reportExternalError(
      error instanceof Error ? error.message : "External Corkdiff failed to open.",
    );
    input.openInApp();
  }
}
