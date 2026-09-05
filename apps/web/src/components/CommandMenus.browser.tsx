import "../index.css";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

const { draftMapping, draftSessions, draftThreads, handleNewThreadSpy, navigateSpy, threadShells } =
  vi.hoisted(() => ({
    draftMapping: { current: {} as Record<string, string> },
    draftSessions: { current: {} as Record<string, { readonly draftId: string }> },
    draftThreads: { current: {} as Record<string, Record<string, unknown>> },
    handleNewThreadSpy: vi.fn(async () => undefined),
    navigateSpy: vi.fn(async () => undefined),
    threadShells: { current: [] as Array<(typeof STATUS_THREADS)[number]> },
  }));
const threadSwitcherBridge = vi.hoisted(() => ({
  listener: null as ((action: string) => void) | null,
  activeListeners: new Set<(action: string) => void>(),
  unsubscribe: vi.fn(),
}));

vi.mock("@effect/atom-react", async () => {
  const actual = await vi.importActual<typeof import("@effect/atom-react")>("@effect/atom-react");
  return { ...actual, useAtomValue: vi.fn(() => ({ environment: { capabilities: {} } })) };
});

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useLocation: ({ select }: { select: (location: { pathname: string }) => unknown }) =>
      select({ pathname: "/" }),
    useParams: () => ({}),
  };
});

vi.mock("../env", () => ({ isElectron: true }));

vi.mock("../keybindings", async () => {
  const actual = await vi.importActual<typeof import("../keybindings")>("../keybindings");
  return {
    ...actual,
    resolveShortcutCommand: (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return null;
      if (event.key.toLowerCase() === "e") return "navigation.commandMenu";
      if (event.key.toLowerCase() === "k") return "commandPalette.toggle";
      return null;
    },
    shortcutLabelForCommand: () => null,
  };
});

const PROJECT = {
  id: "project-menu-test",
  environmentId: "environment-menu-test",
  title: "Navigation project",
  workspaceRoot: "/workspace/navigation-project",
  repositoryIdentity: {
    canonicalKey: "github.com:t3tools/t3code",
    displayName: "t3code",
    name: "t3code",
    rootPath: "/workspace/navigation-project",
  },
  defaultModelSelection: null,
  scripts: [],
  hyprnav: null,
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-10T10:00:00.000Z",
};
const THREAD = {
  id: "thread-menu-test",
  environmentId: "environment-menu-test",
  projectId: "project-menu-test",
  title: "Fix navigation hotkeys",
  modelSelection: { instanceId: "codex", model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "feature/navigation",
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-07-10T10:00:00.000Z",
  updatedAt: "2026-07-11T10:00:00.000Z",
  archivedAt: null,
  session: { status: "running", activeTurnId: "turn-menu-test" },
  latestUserMessageAt: "2026-07-11T10:00:00.000Z",
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};
const STATUS_THREADS = [
  THREAD,
  {
    ...THREAD,
    id: "thread-menu-approval",
    title: "Approval status thread",
    hasPendingApprovals: true,
  },
  {
    ...THREAD,
    id: "thread-menu-input",
    title: "Input status thread",
    hasPendingUserInput: true,
  },
  {
    ...THREAD,
    id: "thread-menu-connecting",
    title: "Connecting status thread",
    session: { status: "starting", activeTurnId: null },
  },
];

vi.mock("../state/entities", async () => {
  const actual = await vi.importActual<typeof import("../state/entities")>("../state/entities");
  return {
    ...actual,
    readEnvironmentSupportsSettlement: () => false,
    useProject: () => null,
    useProjects: () => [PROJECT],
    useThread: () => null,
    useThreadShell: () => null,
    useThreadShells: () => threadShells.current,
  };
});

vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (value: string) => value },
  clearComposerDraftsEnvironment: () => undefined,
  useComposerDraftStore: (selector: (state: unknown) => unknown) =>
    selector({
      draftThreadsByThreadKey: draftThreads.current,
      getDraftSessionByLogicalProjectKey: (logicalProjectKey: string) => {
        const draftId = draftMapping.current[logicalProjectKey];
        return draftId ? (draftSessions.current[draftId] ?? null) : null;
      },
      logicalProjectDraftThreadKeyByLogicalProjectKey: draftMapping.current,
    }),
}));
vi.mock("./Sidebar", () => ({ default: () => null }));
vi.mock("../connection/desktopLocal", () => ({
  desktopLocalBackendId: () => null,
  desktopLocalConnectionId: () => "desktop-local-test",
  isDesktopLocalConnectionTarget: () => false,
  readDesktopSecondaryBootstraps: () => [],
  readDesktopSecondaryBootstrapsResult: () => ({ bootstraps: [] }),
}));

vi.mock("../hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => handleNewThreadSpy,
  useHandleNewThread: () => ({
    activeDraftThread: null,
    activeThread: null,
    defaultProjectRef: null,
    handleNewThread: handleNewThreadSpy,
  }),
}));

vi.mock("../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useSettings")>();
  const { DEFAULT_CLIENT_SETTINGS, DEFAULT_UNIFIED_SETTINGS } =
    await import("@t3tools/contracts/settings");
  const select = <T,>(settings: unknown, selector?: (value: never) => T) =>
    selector ? selector(settings as never) : settings;
  const update = () => undefined;
  return {
    ...actual,
    getClientSettings: () => DEFAULT_CLIENT_SETTINGS,
    useClientSettingsHydrated: () => true,
    mergeEnvironmentSettings: (serverSettings: object, clientSettings: object) => ({
      ...serverSettings,
      ...clientSettings,
    }),
    useClientSettings: (selector?: (settings: never) => unknown) =>
      select(DEFAULT_CLIENT_SETTINGS, selector),
    resolveEnvironmentIdentificationMode: ({ mode }: { mode: string }) => mode,
    useEnvironmentIdentificationMode: () => DEFAULT_CLIENT_SETTINGS.environmentIdentificationMode,
    useLegacySidebarEnabled: () => false,
    useSidebarV2Enabled: () => true,
    useEnvironmentSettings: (_environmentId: string, selector?: (settings: never) => unknown) =>
      select(DEFAULT_UNIFIED_SETTINGS, selector),
    usePrimarySettings: (selector?: (settings: never) => unknown) =>
      select(DEFAULT_UNIFIED_SETTINGS, selector),
    useUpdateEnvironmentSettings: () => update,
    useUpdatePrimarySettings: () => update,
    useUpdateClientSettings: () => update,
    __resetClientSettingsPersistenceForTests: () => undefined,
    __setClientSettingsForTests: () => undefined,
  };
});
vi.mock("../connection/useDesktopLocalBootstraps", () => ({
  useDesktopLocalBootstraps: () => [],
}));
vi.mock("../state/environments", () => ({
  useEnvironment: () => ({ label: "Remote Test" }),
  useEnvironmentHttpBaseUrl: () => null,
  useEnvironments: () => ({ environments: [] }),
  usePrimaryEnvironment: () => null,
  usePrimaryEnvironmentId: () => "primary-environment",
  useRelayEnvironmentDiscovery: () => ({ data: [] }),
}));
vi.mock("../state/terminalSessions", () => ({
  useThreadRunningTerminalIds: () => ["terminal-status-test"],
}));
vi.mock("../state/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/query")>()),
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: false }),
}));
vi.mock("../state/queries", () => ({
  useProjectContentSearch: () => ({
    error: null,
    hasQuery: false,
    invalidRegex: false,
    isPending: false,
    matches: [],
    truncated: false,
  }),
  useProjectPathSearch: () => ({
    entries: [],
    error: null,
    isPending: false,
    refresh: () => undefined,
    searchedQuery: "",
  }),
  useThreadSearch: () => ({ isPending: false, matches: [] }),
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => vi.fn(async () => ({ _tag: "Success", value: undefined })),
}));
vi.mock("../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => vi.fn(async () => ({ _tag: "Success", value: undefined })),
}));
vi.mock("../terminalUiStateStore", () => ({
  selectThreadTerminalUiState: () => ({ terminalOpen: false }),
  useTerminalUiStateStore: (selector: (state: unknown) => unknown) =>
    selector({ terminalUiStateByThreadKey: {} }),
}));
vi.mock("../localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getClientSettings: async () => null,
      setClientSettings: async () => undefined,
    },
  }),
  readLocalApi: () => null,
}));

import { NavigationCommandMenuControl, RecentThreadSwitcherControl } from "./AppSidebarLayout";
import { CommandPalette } from "./CommandPalette";
import type { RecentThreadTarget } from "../recentThreadStore";
import { useRecentThreadStore } from "../recentThreadStore";

function threadTarget(thread: {
  readonly environmentId: string;
  readonly id: string;
}): RecentThreadTarget {
  return {
    kind: "server",
    threadRef: {
      environmentId: thread.environmentId,
      threadId: thread.id,
    },
  } as RecentThreadTarget;
}

describe("keyboard command menus", () => {
  beforeEach(() => {
    threadShells.current = [...STATUS_THREADS];
    threadSwitcherBridge.listener = null;
    threadSwitcherBridge.activeListeners.clear();
    threadSwitcherBridge.unsubscribe.mockClear();
    useRecentThreadStore.getState().reset();
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: {
        onThreadSwitcherAction: (listener: (action: string) => void) => {
          threadSwitcherBridge.listener = listener;
          threadSwitcherBridge.activeListeners.add(listener);
          return () => {
            threadSwitcherBridge.activeListeners.delete(listener);
            threadSwitcherBridge.unsubscribe();
          };
        },
      },
    });
  });

  afterEach(() => {
    draftMapping.current = {};
    draftSessions.current = {};
    draftThreads.current = {};
    handleNewThreadSpy.mockClear();
    navigateSpy.mockClear();
    useRecentThreadStore.getState().reset();
    Reflect.deleteProperty(window, "desktopBridge");
    document.body.innerHTML = "";
  });

  it("cycles frozen MRU entries and navigates exactly once when committed", async () => {
    const [a, b, c] = STATUS_THREADS;
    if (!a || !b || !c) throw new Error("Expected thread fixtures");
    const store = useRecentThreadStore.getState();
    store.recordVisit(threadTarget(a));
    store.recordVisit(threadTarget(b));
    store.recordVisit(threadTarget(c));

    const screen = await render(<RecentThreadSwitcherControl />);
    try {
      await vi.waitFor(() => expect(threadSwitcherBridge.listener).not.toBeNull());

      threadSwitcherBridge.listener?.("advance-forward");
      await expect
        .element(page.getByRole("dialog", { name: "Recent thread switcher" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("option", { name: /Approval status thread/ }))
        .toHaveAttribute("aria-selected", "true");
      expect(navigateSpy).not.toHaveBeenCalled();

      threadSwitcherBridge.listener?.("advance-forward");
      await expect
        .element(page.getByRole("option", { name: /Fix navigation hotkeys/ }))
        .toHaveAttribute("aria-selected", "true");
      threadSwitcherBridge.listener?.("advance-backward");
      await expect
        .element(page.getByRole("option", { name: /Approval status thread/ }))
        .toHaveAttribute("aria-selected", "true");
      expect(navigateSpy).not.toHaveBeenCalled();

      threadSwitcherBridge.listener?.("commit");
      await vi.waitFor(() => {
        expect(navigateSpy).toHaveBeenCalledTimes(1);
        expect(navigateSpy).toHaveBeenCalledWith({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: b.environmentId,
            threadId: b.id,
          },
        });
      });
      await expect
        .element(page.getByRole("dialog", { name: "Recent thread switcher" }))
        .not.toBeInTheDocument();

      threadSwitcherBridge.listener?.("commit");
      expect(navigateSpy).toHaveBeenCalledTimes(1);
    } finally {
      await screen.unmount();
    }
    expect(threadSwitcherBridge.unsubscribe).toHaveBeenCalled();
    expect(threadSwitcherBridge.activeListeners).toHaveLength(0);
  });

  it("does not commit a thread removed during an active gesture", async () => {
    const [a, b] = STATUS_THREADS;
    if (!a || !b) throw new Error("Expected thread fixtures");
    const store = useRecentThreadStore.getState();
    store.recordVisit(threadTarget(a));
    store.recordVisit(threadTarget(b));

    const screen = await render(<RecentThreadSwitcherControl />);
    try {
      await vi.waitFor(() => expect(threadSwitcherBridge.listener).not.toBeNull());
      threadSwitcherBridge.listener?.("advance-forward");
      await expect
        .element(page.getByRole("option", { name: /Fix navigation hotkeys/ }))
        .toHaveAttribute("aria-selected", "true");

      threadShells.current = threadShells.current.filter((thread) => thread.id !== a.id);
      await screen.rerender(<RecentThreadSwitcherControl />);
      threadSwitcherBridge.listener?.("commit");

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(useRecentThreadStore.getState().cycle).toBeNull();
      expect(useRecentThreadStore.getState().history).toEqual([threadTarget(b)]);
    } finally {
      await screen.unmount();
    }
  });

  it("canonicalizes a draft promoted during an active gesture", async () => {
    const [promotedThread, otherThread] = STATUS_THREADS;
    if (!promotedThread || !otherThread) throw new Error("Expected thread fixtures");
    const draftId = "draft-promoted-mid-cycle";
    draftThreads.current = {
      [draftId]: {
        draftId,
        environmentId: PROJECT.environmentId,
        projectId: PROJECT.id,
        promotedTo: null,
      },
    };
    const draftTarget = { kind: "draft", draftId } as RecentThreadTarget;
    const store = useRecentThreadStore.getState();
    store.recordVisit(draftTarget);
    store.recordVisit(threadTarget(otherThread));

    const screen = await render(<RecentThreadSwitcherControl />);
    try {
      await vi.waitFor(() => expect(threadSwitcherBridge.listener).not.toBeNull());
      threadSwitcherBridge.listener?.("advance-forward");
      await expect
        .element(page.getByRole("option", { name: "New thread Navigation project" }))
        .toHaveAttribute("aria-selected", "true");

      draftThreads.current = {
        [draftId]: {
          ...draftThreads.current[draftId],
          promotedTo: {
            environmentId: promotedThread.environmentId,
            threadId: promotedThread.id,
          },
        },
      };
      await screen.rerender(<RecentThreadSwitcherControl />);
      threadSwitcherBridge.listener?.("commit");

      await vi.waitFor(() =>
        expect(navigateSpy).toHaveBeenCalledWith({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: promotedThread.environmentId,
            threadId: promotedThread.id,
          },
        }),
      );
    } finally {
      await screen.unmount();
    }
  });

  it("cancels without navigation and does not stack over another command surface", async () => {
    const [a, b] = STATUS_THREADS;
    if (!a || !b) throw new Error("Expected thread fixtures");
    const store = useRecentThreadStore.getState();
    store.recordVisit(threadTarget(a));
    store.recordVisit(threadTarget(b));

    const screen = await render(
      <>
        <button type="button">Workspace</button>
        <NavigationCommandMenuControl />
        <RecentThreadSwitcherControl />
      </>,
    );
    try {
      await vi.waitFor(() => expect(threadSwitcherBridge.listener).not.toBeNull());
      threadSwitcherBridge.listener?.("advance-forward");
      await expect
        .element(page.getByRole("dialog", { name: "Recent thread switcher" }))
        .toBeInTheDocument();
      threadSwitcherBridge.listener?.("cancel");
      await expect
        .element(page.getByRole("dialog", { name: "Recent thread switcher" }))
        .not.toBeInTheDocument();
      expect(navigateSpy).not.toHaveBeenCalled();

      await page.getByRole("button", { name: "Workspace" }).click();
      await userEvent.keyboard("{Control>}e{/Control}");
      await expect
        .element(page.getByRole("dialog", { name: "Navigation command menu" }))
        .toBeInTheDocument();
      threadSwitcherBridge.listener?.("advance-forward");
      await expect
        .element(page.getByRole("dialog", { name: "Recent thread switcher" }))
        .not.toBeInTheDocument();
      expect(navigateSpy).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("opens navigation with Ctrl+E and routes to the chosen thread", async () => {
    const screen = await render(
      <>
        <button type="button">Workspace</button>
        <NavigationCommandMenuControl />
      </>,
    );
    try {
      await page.getByRole("button", { name: "Workspace" }).click();
      await userEvent.keyboard("{Control>}e{/Control}");
      await expect
        .element(page.getByRole("dialog", { name: "Navigation command menu" }))
        .toBeInTheDocument();
      await expect.element(page.getByLabelText("Working")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Pending Approval")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Awaiting Input")).toBeInTheDocument();
      await expect.element(page.getByLabelText("Connecting")).toBeInTheDocument();
      await expect
        .element(page.getByLabelText("Terminal process running").first())
        .toBeInTheDocument();
      await expect.element(page.getByLabelText("Remote Test").first()).toBeInTheDocument();

      const input = page.getByRole("combobox");
      await input.fill("navigation hotkeys");
      await page.getByRole("option", { name: /Fix navigation hotkeys/ }).click();

      await vi.waitFor(() => {
        expect(navigateSpy).toHaveBeenCalledWith({
          to: "/$environmentId/$threadId",
          params: {
            environmentId: "environment-menu-test",
            threadId: "thread-menu-test",
          },
        });
      });
    } finally {
      await screen.unmount();
    }
  });

  it("opens navigation with Ctrl+E and starts the chosen project draft", async () => {
    const screen = await render(
      <>
        <button type="button">Workspace</button>
        <NavigationCommandMenuControl />
      </>,
    );
    try {
      await page.getByRole("button", { name: "Workspace" }).click();
      await userEvent.keyboard("{Control>}e{/Control}");
      const input = page.getByRole("combobox");
      await input.fill("Navigation project");
      await page.getByRole("option", { name: /^Navigation project/ }).click();

      await vi.waitFor(() => {
        expect(handleNewThreadSpy).toHaveBeenCalledWith({
          environmentId: "environment-menu-test",
          projectId: "project-menu-test",
        });
      });
    } finally {
      await screen.unmount();
    }
  });

  it("opens an existing invested grouped draft instead of creating another", async () => {
    draftMapping.current = {
      "github.com:t3tools/t3code": "invested-draft-id",
    };
    draftSessions.current = {
      "invested-draft-id": { draftId: "invested-draft-id" },
    };
    const screen = await render(<NavigationCommandMenuControl />);
    try {
      await userEvent.keyboard("{Control>}e{/Control}");
      const input = page.getByRole("combobox");
      await input.fill("Navigation project");
      await page.getByRole("option", { name: /Navigation project.*Open draft/ }).click();

      await vi.waitFor(() => {
        expect(navigateSpy).toHaveBeenCalledWith({
          to: "/draft/$draftId",
          params: { draftId: "invested-draft-id" },
        });
      });
      expect(handleNewThreadSpy).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("falls back to a new thread for a stale draft mapping", async () => {
    draftMapping.current = {
      "github.com:t3tools/t3code": "missing-draft-id",
    };
    const screen = await render(<NavigationCommandMenuControl />);
    try {
      await userEvent.keyboard("{Control>}e{/Control}");
      const input = page.getByRole("combobox");
      await input.fill("Navigation project");
      await page.getByRole("option", { name: /Navigation project.*New thread/ }).click();

      await vi.waitFor(() => {
        expect(handleNewThreadSpy).toHaveBeenCalledWith({
          environmentId: "environment-menu-test",
          projectId: "project-menu-test",
        });
      });
      expect(navigateSpy).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("opens the command palette with Ctrl+K and executes settings", async () => {
    const screen = await render(
      <CommandPalette>
        <div>Workspace</div>
      </CommandPalette>,
    );
    try {
      await page.getByText("Workspace", { exact: true }).click();
      await userEvent.keyboard("{Control>}k{/Control}");
      await expect
        .element(page.getByRole("dialog", { name: "Command palette" }))
        .toBeInTheDocument();
      await page.getByText("Open settings", { exact: true }).click();
      await vi.waitFor(() => {
        expect(navigateSpy).toHaveBeenCalledWith({ to: "/settings" });
      });
    } finally {
      await screen.unmount();
    }
  });

  it("does not stack the command palette over open navigation", async () => {
    const screen = await render(
      <CommandPalette>
        <button type="button">Workspace</button>
        <NavigationCommandMenuControl />
      </CommandPalette>,
    );
    try {
      await page.getByRole("button", { name: "Workspace" }).click();
      await userEvent.keyboard("{Control>}e{/Control}");
      await expect
        .element(page.getByRole("dialog", { name: "Navigation command menu" }))
        .toBeInTheDocument();
      await page.getByRole("combobox").click();
      await userEvent.keyboard("{Control>}k{/Control}");
      await expect
        .element(page.getByRole("dialog", { name: "Command palette" }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole("dialog", { name: "Navigation command menu" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("isolates keyboard events from global handlers while navigation is open", async () => {
    const globalHandler = vi.fn();
    window.addEventListener("keydown", globalHandler);
    const screen = await render(
      <>
        <button type="button">Workspace</button>
        <NavigationCommandMenuControl />
      </>,
    );
    try {
      await page.getByRole("button", { name: "Workspace" }).click();
      await userEvent.keyboard("{Control>}e{/Control}");
      globalHandler.mockClear();
      await page.getByRole("combobox").click();
      await userEvent.keyboard("{Control>}o{/Control}");
      expect(globalHandler).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", globalHandler);
      await screen.unmount();
    }
  });
});
