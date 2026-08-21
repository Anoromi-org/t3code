import "../../index.css";

import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ResolvedKeybindingsConfig,
  type ServerProvider,
  type VcsRef,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { createModelSelection } from "@t3tools/shared/model";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { createRef } from "react";

import { DraftId, useComposerDraftStore } from "../../composerDraftStore";
import type { Thread } from "../../types";
import { ChatComposer, type ChatComposerHandle, type ChatComposerProps } from "./ChatComposer";

const refs: VcsRef[] = [
  { name: "main", current: true, isDefault: true, worktreePath: "/repo" },
  {
    name: "feature/existing",
    current: false,
    isDefault: false,
    worktreePath: "/repo/worktrees/existing",
  },
  {
    name: "andrii/eng-6363-chore-xero-publishing-doesnt-allow-url-to-be-ip-address",
    current: false,
    isDefault: false,
    worktreePath: null,
  },
  { name: "main-old", current: false, isDefault: false, worktreePath: null },
];
let branchRefsPending = false;
let branchRefsHaveData = true;
let branchQueries: string[] = [];
let branchNextCursor: string | null = null;
const loadNextBranches = vi.fn();

vi.mock("../../state/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/queries")>();
  return {
    ...actual,
    usePaginatedBranches: ({ query }: { query?: string }) => {
      branchQueries.push(query ?? "");
      return {
        refs: refs.filter((ref) => !query || ref.name.toLowerCase().includes(query.toLowerCase())),
        data: branchRefsHaveData ? { totalCount: refs.length, nextCursor: branchNextCursor } : null,
        isPending: branchRefsPending,
        isFetchingNextPage: false,
        loadNext: loadNextBranches,
        refresh: vi.fn(),
      };
    },
  };
});

vi.mock("../../lib/composerPathSearchState", () => ({
  useComposerPathSearch: () => ({ entries: [], isLoading: false }),
}));

vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

const ENVIRONMENT_ID = EnvironmentId.make("environment-slash-test");
const PROJECT_ID = ProjectId.make("project-slash-test");
const THREAD_ID = ThreadId.make("thread-slash-test");
const DRAFT_ID = DraftId.make("draft-slash-test");
const INSTANCE_ID = ProviderInstanceId.make("codex");
const DRIVER = ProviderDriverKind.make("codex");
const MODEL = "descriptor-model";
const NOW = "2026-07-12T00:00:00.000Z";

const provider: ServerProvider = {
  instanceId: INSTANCE_ID,
  driver: DRIVER,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: NOW,
  models: [
    {
      slug: MODEL,
      name: "Descriptor model",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "normal", label: "Normal", isDefault: true },
              { id: "high", label: "High" },
              { id: "ultrathink", label: "Ultrathink" },
            ],
            promptInjectedValues: ["ultrathink"],
          },
          {
            id: "serviceTier",
            label: "Service Tier",
            type: "select",
            options: [
              { id: "default", label: "Standard", isDefault: true },
              { id: "priority", label: "Fast" },
            ],
            currentValue: "default",
          },
        ],
      },
    },
  ],
  slashCommands: [],
  skills: [],
};

const activeThread: Thread = {
  environmentId: ENVIRONMENT_ID,
  id: THREAD_ID,
  projectId: PROJECT_ID,
  title: "Slash command test",
  modelSelection: createModelSelection(INSTANCE_ID, MODEL),
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

function resetDraft() {
  branchRefsPending = false;
  branchRefsHaveData = true;
  branchQueries = [];
  branchNextCursor = null;
  loadNextBranches.mockReset();
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyActiveProvider: null,
  });
  useComposerDraftStore
    .getState()
    .setLogicalProjectDraftThreadId(
      "slash-project",
      { environmentId: ENVIRONMENT_ID, projectId: PROJECT_ID },
      DRAFT_ID,
      {
        threadId: THREAD_ID,
        branch: "main",
        worktreePath: null,
        envMode: "local",
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: NOW,
      },
    );
  useComposerDraftStore
    .getState()
    .setModelSelection(DRAFT_ID, createModelSelection(INSTANCE_ID, MODEL));
}

async function mountComposer(
  options: {
    onSelectRunContext?: ChatComposerProps["onSelectRunContext"];
    hasVcsRepository?: boolean;
    activeRunContextBranch?: string | null;
    isRunContextBranchPending?: boolean;
    planModeEnabled?: boolean;
    providerStatuses?: ReadonlyArray<ServerProvider>;
  } = {},
) {
  const composerRef = createRef<ChatComposerHandle>();
  const promptRef = { current: "" };
  const onSend = vi.fn((event?: { preventDefault: () => void }) => event?.preventDefault());
  const onSelectRunContext =
    options.onSelectRunContext ?? vi.fn<ChatComposerProps["onSelectRunContext"]>(async () => true);
  const handleInteractionModeChange = vi.fn();
  const screen = await render(
    <ChatComposer
      composerRef={composerRef}
      composerDraftTarget={DRAFT_ID}
      environmentId={ENVIRONMENT_ID}
      routeKind="draft"
      routeThreadRef={scopeThreadRef(ENVIRONMENT_ID, THREAD_ID)}
      draftId={DRAFT_ID}
      activeThreadId={THREAD_ID}
      activeThreadEnvironmentId={ENVIRONMENT_ID}
      activeThread={activeThread}
      isServerThread={false}
      isLocalDraftThread
      forceExpandedOnMobile={false}
      projectSelectionRequired={false}
      phase="ready"
      isConnecting={false}
      isSendBusy={false}
      sendDisabledReason={null}
      isPreparingWorktree={false}
      environmentUnavailable={null}
      activePendingApproval={null}
      pendingApprovals={[]}
      pendingUserInputs={[]}
      activePendingProgress={null}
      activePendingResolvedAnswers={null}
      activePendingIsResponding={false}
      activePendingDraftAnswers={{}}
      activePendingQuestionIndex={0}
      respondingRequestIds={[]}
      showPlanFollowUpPrompt={false}
      activeProposedPlan={null}
      runtimeMode="full-access"
      interactionMode="default"
      lockedProvider={null}
      providerStatuses={[...(options.providerStatuses ?? [provider])]}
      activeProjectDefaultModelSelection={createModelSelection(INSTANCE_ID, MODEL)}
      activeThreadModelSelection={createModelSelection(INSTANCE_ID, MODEL)}
      activeThreadActivities={[]}
      resolvedTheme="dark"
      settings={{
        ...DEFAULT_UNIFIED_SETTINGS,
        planModeEnabled: options.planModeEnabled ?? DEFAULT_UNIFIED_SETTINGS.planModeEnabled,
      }}
      keybindings={[] as ResolvedKeybindingsConfig}
      terminalOpen={false}
      gitCwd="/repo"
      activeProjectCwd="/repo"
      hasVcsRepository={options.hasVcsRepository ?? true}
      canChangeWorktreeContext={options.hasVcsRepository ?? true}
      runContextEnvMode="local"
      activeRunContextBranch={
        options.activeRunContextBranch === undefined ? "main" : options.activeRunContextBranch
      }
      isRunContextBranchPending={options.isRunContextBranchPending ?? false}
      activeRunContextWorktreePath={null}
      promptRef={promptRef}
      composerImagesRef={{ current: [] }}
      composerTerminalContextsRef={{ current: [] }}
      composerElementContextsRef={{ current: [] }}
      onSend={onSend}
      onInterrupt={vi.fn()}
      onImplementPlanInNewThread={vi.fn()}
      onRespondToApproval={vi.fn(async () => undefined)}
      onSelectActivePendingUserInputOption={vi.fn()}
      onAdvanceActivePendingUserInput={vi.fn()}
      onPreviousActivePendingUserInputQuestion={vi.fn()}
      onChangeActivePendingUserInputCustomAnswer={vi.fn()}
      onProviderModelSelect={vi.fn()}
      onSelectRunContext={onSelectRunContext}
      getModelDisabledReason={() => null}
      toggleInteractionMode={vi.fn()}
      handleRuntimeModeChange={vi.fn()}
      handleInteractionModeChange={handleInteractionModeChange}
      focusComposer={vi.fn()}
      scheduleComposerFocus={vi.fn()}
      setThreadError={vi.fn()}
      onExpandImage={vi.fn()}
    />,
  );
  return { screen, onSelectRunContext, onSend, handleInteractionModeChange };
}

describe("composer slash commands", () => {
  beforeEach(resetDraft);

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("selects a live reasoning mode with typing and Enter", async () => {
    const mounted = await mountComposer();
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/reasoning high");
      await expect
        .element(page.getByRole("option", { name: /\/reasoning high/ }))
        .toBeInTheDocument();
      await userEvent.keyboard("{Enter}");

      await vi.waitFor(() => {
        expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe("");
        expect(
          useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.modelSelectionByProvider[
            INSTANCE_ID
          ]?.options,
        ).toContainEqual({ id: "reasoningEffort", value: "high" });
      });

      await editor.fill("/reasoning normal");
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => {
        expect(
          useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.modelSelectionByProvider[
            INSTANCE_ID
          ]?.options,
        ).toContainEqual({ id: "reasoningEffort", value: "normal" });
      });
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("clears prompt-injected reasoning when selecting another mode", async () => {
    const mounted = await mountComposer();
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("Ultrathink:\n/reasoning high");
      await userEvent.keyboard("{Enter}");

      await vi.waitFor(() => {
        expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe("");
        expect(
          useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.modelSelectionByProvider[
            INSTANCE_ID
          ]?.options,
        ).toContainEqual({ id: "reasoningEffort", value: "high" });
      });
    } finally {
      mounted.screen.unmount();
    }
  });

  it("applies prompt-injected reasoning modes to the prompt", async () => {
    const mounted = await mountComposer();
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/reasoning ultrathink");
      await userEvent.keyboard("{Enter}");

      await vi.waitFor(() => {
        const draft = useComposerDraftStore.getState().getComposerDraft(DRAFT_ID);
        expect(draft?.prompt).toBe("Ultrathink:\n");
        expect(draft?.modelSelectionByProvider[INSTANCE_ID]?.options ?? []).not.toContainEqual({
          id: "reasoningEffort",
          value: "ultrathink",
        });
      });
    } finally {
      mounted.screen.unmount();
    }
  });

  it("does not offer a named worktree until refs finish loading", async () => {
    branchRefsPending = true;
    branchRefsHaveData = false;
    const mounted = await mountComposer();
    try {
      await page.getByTestId("composer-editor").fill("/worktree feature/new");
      await expect
        .element(page.getByRole("option", { name: "/worktree feature/new" }))
        .not.toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(mounted.onSend).not.toHaveBeenCalled();
      expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe(
        "/worktree feature/new",
      );
    } finally {
      mounted.screen.unmount();
    }
  });

  it("does not accept a named worktree before its base branch resolves", async () => {
    const onSelectRunContext = vi.fn<ChatComposerProps["onSelectRunContext"]>(async () => true);
    const mounted = await mountComposer({
      onSelectRunContext,
      activeRunContextBranch: null,
      isRunContextBranchPending: true,
    });
    try {
      await page.getByTestId("composer-editor").fill("/worktree feature/new");
      await expect
        .element(page.getByRole("option", { name: "/worktree feature/new" }))
        .not.toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).not.toHaveBeenCalled();
      expect(mounted.onSend).not.toHaveBeenCalled();
      expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe(
        "/worktree feature/new",
      );
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("hides VCS actions outside a repository", async () => {
    const mounted = await mountComposer({ hasVcsRepository: false });
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/");
      await expect.element(page.getByRole("option", { name: /^\/branch/ })).not.toBeInTheDocument();
      await expect
        .element(page.getByRole("option", { name: /^\/worktree/ }))
        .not.toBeInTheDocument();

      await editor.fill("/branch main");
      await userEvent.keyboard("{Enter}");
      expect(mounted.onSend).not.toHaveBeenCalled();
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("debounces ref searches while typing a slash command", async () => {
    const mounted = await mountComposer();
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.click();
      await userEvent.keyboard("/branch feature");
      await vi.waitFor(() => {
        expect(branchQueries.at(-1)).toBe("feature");
      });
      expect([...new Set(branchQueries.filter((query) => query.length > 0))]).toEqual(["feature"]);
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("loads every branch page while the VCS slash menu is open", async () => {
    branchNextCursor = "page-2";
    const mounted = await mountComposer();
    try {
      await page.getByTestId("composer-editor").fill("/branch");
      await vi.waitFor(() => expect(loadNextBranches).toHaveBeenCalled());
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("lists every supported keyboard action from the bare slash menu", async () => {
    const mounted = await mountComposer();
    try {
      await page.getByTestId("composer-editor").fill("/");
      for (const command of ["/model", "/branch", "/worktree", "/fast", "/reasoning"]) {
        await expect
          .element(page.getByRole("option", { name: new RegExp(`^${command}`) }))
          .toBeInTheDocument();
      }
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("keeps legacy plan commands behind the plan mode setting", async () => {
    const disabled = await mountComposer({ planModeEnabled: false });
    try {
      await page.getByTestId("composer-editor").fill("/");
      await expect.element(page.getByRole("option", { name: /^\/plan/ })).not.toBeInTheDocument();
      await expect
        .element(page.getByRole("option", { name: /^\/default/ }))
        .not.toBeInTheDocument();
    } finally {
      await disabled.screen.unmount();
    }

    const enabled = await mountComposer({ planModeEnabled: true });
    try {
      await page.getByTestId("composer-editor").fill("/");
      await expect.element(page.getByRole("option", { name: /^\/plan/ })).toBeInTheDocument();
      await expect.element(page.getByRole("option", { name: /^\/default/ })).toBeInTheDocument();
      await page.getByRole("option", { name: /^\/plan/ }).click();
      expect(enabled.handleInteractionModeChange).toHaveBeenCalledWith("plan");
    } finally {
      await enabled.screen.unmount();
    }
  });

  it("sends disabled legacy plan commands as ordinary prompt text", async () => {
    const mounted = await mountComposer({ planModeEnabled: false });
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/plan");
      await userEvent.keyboard("{Enter}");
      expect(mounted.handleInteractionModeChange).not.toHaveBeenCalled();
      expect(mounted.onSend).toHaveBeenCalledOnce();
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("shows the provider default and toggles fast mode from the keyboard", async () => {
    const mounted = await mountComposer();
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/reasoning ");
      await expect.element(page.getByText("Normal (default)", { exact: true })).toBeInTheDocument();

      await editor.fill("/fast");
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => {
        expect(
          useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.modelSelectionByProvider[
            INSTANCE_ID
          ]?.options,
        ).toContainEqual({ id: "serviceTier", value: "priority" });
        expect(
          useComposerDraftStore.getState().stickyModelSelectionByProvider[INSTANCE_ID]?.options,
        ).toContainEqual({ id: "serviceTier", value: "priority" });
      });

      await editor.fill("/fast");
      await userEvent.keyboard("{Enter}");
      await vi.waitFor(() => {
        expect(
          useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.modelSelectionByProvider[
            INSTANCE_ID
          ]?.options,
        ).toContainEqual({ id: "serviceTier", value: "default" });
      });
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("leaves unsupported /fast available for normal submission", async () => {
    const providerWithoutFast: ServerProvider = {
      ...provider,
      models: provider.models.map((model) => ({
        ...model,
        capabilities: { optionDescriptors: [] },
      })),
    };
    const mounted = await mountComposer({ providerStatuses: [providerWithoutFast] });
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/fast");
      await page.getByRole("button", { name: "Send message" }).click();
      expect(mounted.onSend).toHaveBeenCalledTimes(1);
      expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe("/fast");
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("submits /fast normally when composer context is attached", async () => {
    const mounted = await mountComposer();
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/fast");
      useComposerDraftStore.getState().setTerminalContexts(DRAFT_ID, [
        {
          id: "context-fast-test",
          threadId: THREAD_ID,
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 1,
          lineEnd: 1,
          text: "context",
          createdAt: NOW,
        },
      ]);
      await expect.element(page.getByRole("option", { name: /^\/fast/ })).not.toBeInTheDocument();
      await editor.click();
      await userEvent.keyboard("{Enter}");

      expect(mounted.onSend).toHaveBeenCalledTimes(1);
      expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toContain(
        "/fast",
      );
      expect(
        useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.modelSelectionByProvider[
          INSTANCE_ID
        ]?.options ?? [],
      ).not.toContainEqual({ id: "serviceTier", value: "priority" });
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("selects branches and named worktrees without pointer input", async () => {
    const onSelectRunContext = vi.fn<ChatComposerProps["onSelectRunContext"]>(async () => true);
    const mounted = await mountComposer({ onSelectRunContext });
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/branch existing");
      await expect
        .element(page.getByRole("option", { name: /feature\/existing/ }))
        .toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).toHaveBeenLastCalledWith({
        branch: refs[1],
        envMode: "worktree",
        selectionIntent: "branch",
      });

      await editor.fill("/branch main");
      await expect
        .element(page.getByRole("option", { name: "main Current branch", exact: true }))
        .toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).toHaveBeenLastCalledWith({
        branch: refs[0],
        envMode: "local",
        selectionIntent: "branch",
      });

      await editor.fill("/worktree main");
      await expect
        .element(page.getByRole("option", { name: "main Current branch", exact: true }))
        .toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).toHaveBeenLastCalledWith({
        branch: refs[0],
        envMode: "worktree",
        selectionIntent: "worktree",
      });

      await editor.fill("/worktree main-old");
      await expect
        .element(page.getByRole("option", { name: "main-old", exact: true }))
        .toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).toHaveBeenLastCalledWith({
        branch: refs[3],
        envMode: "worktree",
        selectionIntent: "worktree",
        worktreeBranchName: "main-old",
      });

      await editor.fill("/worktree feature/new-command");
      await expect
        .element(page.getByRole("option", { name: "/worktree feature/new-command" }))
        .toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).toHaveBeenLastCalledWith({
        branch: "main",
        envMode: "worktree",
        worktreeBranchName: "feature/new-command",
      });

      await editor.fill("/worktree local");
      await expect
        .element(page.getByRole("option", { name: /\/worktree local/ }))
        .toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).toHaveBeenLastCalledWith({ branch: null, envMode: "local" });
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("selects exact branches while the ref stream refreshes in the background", async () => {
    branchRefsPending = true;
    const onSelectRunContext = vi.fn<ChatComposerProps["onSelectRunContext"]>(async () => true);
    const mounted = await mountComposer({ onSelectRunContext });
    try {
      const editor = page.getByTestId("composer-editor");
      for (const branch of [refs[0], refs[2]]) {
        if (!branch) throw new Error("Expected branch test fixture");
        await editor.fill(`/branch ${branch.name}`);
        await expect
          .element(
            page.getByRole("option", {
              name: branch === refs[0] ? "main Current branch" : `${branch.name} Local branch`,
              exact: true,
            }),
          )
          .toBeInTheDocument();
        await userEvent.keyboard("{Enter}");
        expect(onSelectRunContext).toHaveBeenLastCalledWith({
          branch,
          envMode: "local",
          selectionIntent: "branch",
        });
      }
      expect(onSelectRunContext).toHaveBeenCalledTimes(2);
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("keeps an unknown branch command intact after loading completes", async () => {
    const onSelectRunContext = vi.fn<ChatComposerProps["onSelectRunContext"]>(async () => true);
    const mounted = await mountComposer({ onSelectRunContext });
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/branch missing-branch");
      await vi.waitFor(() => {
        expect(branchQueries.at(-1)).toBe("missing-branch");
      });
      await expect.element(page.getByRole("option")).not.toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(onSelectRunContext).not.toHaveBeenCalled();
      expect(mounted.onSend).not.toHaveBeenCalled();
      expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe(
        "/branch missing-branch",
      );
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("blocks repeated pointer selections while a context change is pending", async () => {
    let finishSelection: ((applied: boolean) => void) | undefined;
    const onSelectRunContext = vi.fn<ChatComposerProps["onSelectRunContext"]>(
      () =>
        new Promise<boolean>((resolve) => {
          finishSelection = resolve;
        }),
    );
    const mounted = await mountComposer({ onSelectRunContext });
    try {
      await page.getByTestId("composer-editor").fill("/branch existing");
      const option = page.getByRole("option", { name: /feature\/existing/ });
      await expect.element(option).toBeInTheDocument();
      const optionElement = document.querySelector<HTMLElement>(
        '[data-composer-item-id^="branch:feature/existing:"]',
      );
      expect(optionElement).not.toBeNull();
      optionElement?.click();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      optionElement?.click();
      expect(onSelectRunContext).toHaveBeenCalledTimes(1);
      const form = document.querySelector<HTMLFormElement>('[data-chat-composer-form="true"]');
      expect(form).not.toBeNull();
      expect(form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))).toBe(
        false,
      );
      expect(mounted.onSend).not.toHaveBeenCalled();
      finishSelection?.(true);
      await vi.waitFor(() => {
        expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe("");
      });
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("keeps the slash command when a context change does not apply", async () => {
    const onSelectRunContext = vi.fn<ChatComposerProps["onSelectRunContext"]>(async () => false);
    const mounted = await mountComposer({ onSelectRunContext });
    try {
      const editor = page.getByTestId("composer-editor");
      await editor.fill("/branch existing");
      await expect
        .element(page.getByRole("option", { name: /feature\/existing/ }))
        .toBeInTheDocument();
      document
        .querySelector<HTMLElement>('[data-composer-item-id^="branch:feature/existing:"]')
        ?.click();
      await vi.waitFor(() => {
        expect(onSelectRunContext).toHaveBeenCalledOnce();
        expect(useComposerDraftStore.getState().getComposerDraft(DRAFT_ID)?.prompt).toBe(
          "/branch existing",
        );
      });
    } finally {
      await mounted.screen.unmount();
    }
  });

  it("does not keep the removed /r alias open", async () => {
    const mounted = await mountComposer();
    try {
      await page.getByTestId("composer-editor").fill("/r high");
      await expect
        .element(page.getByText("/reasoning high", { exact: true }))
        .not.toBeInTheDocument();
    } finally {
      await mounted.screen.unmount();
    }
  });
});
