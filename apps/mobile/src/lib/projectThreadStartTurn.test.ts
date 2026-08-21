import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { serializeAssistantCitation } from "@t3tools/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProjectThreadStartTurnInput,
  deriveThreadTitleFromPrompt,
} from "./projectThreadStartTurn";

describe("project thread title", () => {
  it("keeps ordinary titles and the empty-prompt fallback", () => {
    expect(deriveThreadTitleFromPrompt("  Fix\n the parser  ")).toBe("Fix the parser");
    expect(deriveThreadTitleFromPrompt(" \n ")).toBe("New thread");
  });

  it.each([
    {
      comment: undefined,
      title: "Keep `cache[key]` & <parser> shared. Retry!",
    },
    {
      comment: 'Why "shared"?',
      title: 'Keep `cache[key]` & <parser> shared. Retry! Comment: Why "shared"?',
    },
  ])("uses readable titles and intact links with comment $comment", ({ comment, title }) => {
    const quoteText = "Keep `cache[key]` & <parser> shared.\n  Retry!";
    const text = serializeAssistantCitation({
      version: 1,
      environmentId: EnvironmentId.make("source-environment"),
      threadId: ThreadId.make("source-thread"),
      messageId: MessageId.make("source-message"),
      text: quoteText,
      ...(comment === undefined ? {} : { comment }),
      start: 0,
      end: quoteText.length,
      prefix: "",
      suffix: "",
    });
    const input = buildProjectThreadStartTurnInput({
      projectId: ProjectId.make("project"),
      projectCwd: "/workspace",
      threadId: "new-thread",
      commandId: "command",
      messageId: "message",
      createdAt: "2026-09-01T00:00:00Z",
      text,
      uploadedAttachments: [],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
      startFromOrigin: false,
      supportsServerBranchGeneration: true,
    });

    expect(input.titleSeed).toBe(title);
    expect(input.bootstrap.createThread.title).toBe(input.titleSeed);
    expect(input.message.text).toBe(text);
  });
});

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
