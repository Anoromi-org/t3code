import {
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationMessageContext,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@t3tools/contracts";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";

import type { UploadedMobileAttachment } from "./attachmentUpload";

export function deriveThreadTitleFromPrompt(value: string): string {
  const trimmed = assistantCitationsToPlainText(value).trim();
  if (trimmed.length === 0) {
    return "New thread";
  }

  const compact = trimmed.replace(/\s+/g, " ");
  return compact.length <= 72 ? compact : `${compact.slice(0, 69).trimEnd()}...`;
}

export interface ProjectThreadStartTurnSpec {
  readonly projectId: ProjectId;
  readonly projectCwd: string;
  readonly threadId: string;
  readonly commandId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly text: string;
  readonly context?: OrchestrationMessageContext;
  /** Wire attachments from `prepareTurnAttachments`, in composer order. */
  readonly uploadedAttachments: ReadonlyArray<UploadedMobileAttachment>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin: boolean;
  /** The server names new worktree branches (`worktreeBranchGeneration`). */
  readonly supportsServerBranchGeneration: boolean;
  /** Temporary branch for servers that cannot name new worktrees. */
  readonly legacyBranchName?: string;
}

/**
 * Worktree-mode bootstrap: prepares a new worktree unless one is already
 * selected. The server names its branch, or older servers get a temporary one.
 */
export function buildProjectThreadWorkspaceBootstrap(input: {
  readonly projectCwd: string;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin: boolean;
  readonly supportsServerBranchGeneration: boolean;
  readonly legacyBranchName?: string;
}) {
  if (input.workspaceMode === "local" || input.worktreePath !== null) {
    return {};
  }
  return {
    prepareWorktree: {
      projectCwd: input.projectCwd,
      baseBranch: input.branch!,
      ...(input.supportsServerBranchGeneration || input.legacyBranchName === undefined
        ? { generateBranch: true as const }
        : { branch: input.legacyBranchName }),
      ...(input.startFromOrigin ? { startFromOrigin: true as const } : {}),
    },
    runSetupScript: true as const,
  };
}

/**
 * Single source of the `thread.turn.start` bootstrap payload used to create a
 * thread from a project draft — shared by the immediate send path and the
 * offline outbox drain so both deliver identical commands.
 */
export function buildProjectThreadStartTurnInput(spec: ProjectThreadStartTurnSpec) {
  const title = deriveThreadTitleFromPrompt(spec.text);
  return {
    commandId: CommandId.make(spec.commandId),
    threadId: ThreadId.make(spec.threadId),
    message: {
      messageId: MessageId.make(spec.messageId),
      role: "user" as const,
      text: spec.text,
      ...(spec.context ? { context: spec.context } : {}),
      attachments: spec.uploadedAttachments,
    },
    modelSelection: spec.modelSelection,
    titleSeed: title,
    runtimeMode: spec.runtimeMode,
    interactionMode: spec.interactionMode,
    bootstrap: {
      createThread: {
        projectId: spec.projectId,
        title,
        modelSelection: spec.modelSelection,
        runtimeMode: spec.runtimeMode,
        interactionMode: spec.interactionMode,
        branch: spec.branch,
        worktreePath: spec.worktreePath,
        createdAt: spec.createdAt,
      },
      ...buildProjectThreadWorkspaceBootstrap({
        projectCwd: spec.projectCwd,
        workspaceMode: spec.workspaceMode,
        branch: spec.branch,
        worktreePath: spec.worktreePath,
        startFromOrigin: spec.startFromOrigin,
        supportsServerBranchGeneration: spec.supportsServerBranchGeneration,
        ...(spec.legacyBranchName !== undefined ? { legacyBranchName: spec.legacyBranchName } : {}),
      }),
    },
    createdAt: spec.createdAt,
  };
}
