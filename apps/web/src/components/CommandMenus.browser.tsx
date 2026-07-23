import "../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

const { draftMapping, draftSessions, handleNewThreadSpy, navigateSpy } = vi.hoisted(() => ({
  draftMapping: { current: {} as Record<string, string> },
  draftSessions: { current: {} as Record<string, { readonly draftId: string }> },
  handleNewThreadSpy: vi.fn(async () => undefined),
  navigateSpy: vi.fn(async () => undefined),
}));

vi.mock("@effect/atom-react", async () => {
  const actual = await vi.importActual<typeof import("@effect/atom-react")>("@effect/atom-react");
  return { ...actual, useAtomValue: vi.fn(() => ({})) };
});

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    useParams: () => ({}),
  };
});

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
  session: null,
  latestUserMessageAt: "2026-07-11T10:00:00.000Z",
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

vi.mock("../state/entities", async () => {
  const actual = await vi.importActual<typeof import("../state/entities")>("../state/entities");
  return {
    ...actual,
    readEnvironmentSupportsSettlement: () => false,
    useProject: () => null,
    useProjects: () => [PROJECT],
    useThread: () => null,
    useThreadShell: () => null,
    useThreadShells: () => [THREAD],
  };
});

vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (value: string) => value },
  clearComposerDraftsEnvironment: () => undefined,
  useComposerDraftStore: (selector: (state: unknown) => unknown) =>
    selector({
      draftThreadsByThreadKey: {},
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

vi.mock("../hooks/useSettings", async () => {
  const { DEFAULT_CLIENT_SETTINGS, DEFAULT_UNIFIED_SETTINGS } =
    await import("@t3tools/contracts/settings");
  const select = <T,>(settings: unknown, selector?: (value: never) => T) =>
    selector ? selector(settings as never) : settings;
  const update = () => undefined;
  return {
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
  useEnvironment: () => null,
  useEnvironmentHttpBaseUrl: () => null,
  useEnvironments: () => ({ environments: [] }),
  usePrimaryEnvironment: () => null,
  usePrimaryEnvironmentId: () => null,
  useRelayEnvironmentDiscovery: () => ({ data: [] }),
}));
vi.mock("../state/query", () => ({
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

import { NavigationCommandMenuControl } from "./AppSidebarLayout";
import { CommandPalette } from "./CommandPalette";

describe("keyboard command menus", () => {
  afterEach(() => {
    draftMapping.current = {};
    draftSessions.current = {};
    handleNewThreadSpy.mockClear();
    navigateSpy.mockClear();
    document.body.innerHTML = "";
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
