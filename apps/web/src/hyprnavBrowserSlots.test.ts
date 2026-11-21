import {
  DEFAULT_PROJECT_HYPRNAV_SETTINGS,
  EnvironmentId,
  type HyprnavBrowserSlot,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHyprnavBrowserTabThreads,
  computeHyprnavBrowserTabClears,
  HYPRNAV_BROWSER_TAB_HISTORY_STORAGE_KEY,
  hyprnavBrowserTabHistoryKey,
  hyprnavThreadBindingSlots,
  loadHyprnavBrowserTabHistory,
  markHyprnavBrowserTabAttempt,
  persistHyprnavBrowserTabHistory,
  recordHyprnavBrowserTabs,
  resolveHyprnavBrowserTabs,
  type HyprnavBrowserTabHistory,
} from "./hyprnavBrowserSlots";
import {
  browserSlotDraftFromSettings,
  parseHyprnavBrowserSlotsDraft,
} from "./components/settings/HyprnavBrowserSlotsSettings";

const GROUPING = {
  sidebarProjectGroupingMode: "repository" as const,
  sidebarProjectGroupingOverrides: {},
};

const PR_SLOT: HyprnavBrowserSlot = {
  slot: 6,
  workspace: 16,
  browser: "chromium",
  tabName: "pr-review",
  url: "http://127.0.0.1:4318/",
  param: "branch",
  value: "branch",
};

const CHECKOUT_SLOT: HyprnavBrowserSlot = { ...PR_SLOT, param: "checkout", value: "checkout" };

const PR_TAB = {
  slot: 6,
  workspaceId: 16,
  browser: "chromium",
  tabName: "pr-review",
  value: "feature/a",
} as const;

describe("resolveHyprnavBrowserTabs", () => {
  it("uses the thread branch as the tab value", () => {
    expect(
      resolveHyprnavBrowserTabs({
        slots: [PR_SLOT],
        thread: { branch: " feature/a ", checkoutPath: "/repo/wt/a" },
        bindingSlots: new Set(),
      }),
    ).toEqual([PR_TAB]);
  });

  it("skips threads without a branch and slots a thread binding owns", () => {
    expect(
      resolveHyprnavBrowserTabs({
        slots: [PR_SLOT],
        thread: { branch: null, checkoutPath: "/repo" },
        bindingSlots: new Set(),
      }),
    ).toEqual([]);
    expect(
      resolveHyprnavBrowserTabs({
        slots: [PR_SLOT],
        thread: { branch: "feature/a", checkoutPath: "/repo/wt/a" },
        bindingSlots: hyprnavThreadBindingSlots({
          bindings: [
            {
              id: "corkdiff",
              slot: 6,
              scope: "thread",
              workspace: { mode: "managed" },
              action: "nothing",
            },
          ],
        }),
      }),
    ).toEqual([]);
  });

  it("uses the checkout path for checkout slots, even without a branch", () => {
    expect(
      resolveHyprnavBrowserTabs({
        slots: [CHECKOUT_SLOT],
        thread: { branch: null, checkoutPath: "/repo" },
        bindingSlots: new Set(),
      }),
    ).toEqual([{ ...PR_TAB, value: "/repo" }]);
  });

  it("only counts thread-scope bindings as owners", () => {
    expect([...hyprnavThreadBindingSlots(DEFAULT_PROJECT_HYPRNAV_SETTINGS)]).toEqual([8]);
  });
});

describe("browser tab history", () => {
  const key = hyprnavBrowserTabHistoryKey({
    projectRoot: "/repo",
    worktreePath: null,
    threadId: "thread-1",
  });

  it("clears slots attached earlier that are no longer wanted", () => {
    expect(computeHyprnavBrowserTabClears([6, 7], [PR_TAB])).toEqual([7]);
    expect(computeHyprnavBrowserTabClears(undefined, [PR_TAB])).toEqual([]);
  });

  it("keeps attempted slots until a sync succeeds", () => {
    const history: HyprnavBrowserTabHistory = new Map([[key, [7]]]);
    markHyprnavBrowserTabAttempt(history, key, [PR_TAB]);
    expect(history.get(key)).toEqual([6, 7]);
    recordHyprnavBrowserTabs(history, key, [PR_TAB]);
    expect(history.get(key)).toEqual([6]);
    recordHyprnavBrowserTabs(history, key, []);
    expect(history.has(key)).toBe(false);
  });

  it("round-trips through storage and rejects malformed data", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (name: string) => store.get(name) ?? null,
      setItem: (name: string, value: string) => void store.set(name, value),
    };
    persistHyprnavBrowserTabHistory(new Map([[key, [6]]]), storage);
    expect(loadHyprnavBrowserTabHistory(storage)).toEqual(new Map([[key, [6]]]));
    store.set(
      HYPRNAV_BROWSER_TAB_HISTORY_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: [[key, [0]]] }),
    );
    expect(loadHyprnavBrowserTabHistory(storage)).toEqual(new Map());
  });
});

describe("buildHyprnavBrowserTabThreads", () => {
  const localEnvironmentId = EnvironmentId.make("local");
  const project = {
    environmentId: localEnvironmentId,
    id: ProjectId.make("project-1"),
    title: "Repo",
    workspaceRoot: "/repo",
    hyprnav: null,
  };
  const thread = (id: string, overrides: Record<string, unknown> = {}) => ({
    environmentId: localEnvironmentId,
    id: ThreadId.make(id),
    projectId: project.id,
    title: `Thread ${id}`,
    branch: `feature/${id}`,
    worktreePath: `/repo/wt/${id}`,
    archivedAt: null,
    ...overrides,
  });

  it("assigns branch threads, clears stale ones and skips unchanged no-ops", () => {
    const staleKey = hyprnavBrowserTabHistoryKey({
      projectRoot: "/repo",
      worktreePath: "/repo/wt/b",
      threadId: "b",
    });
    const threads = buildHyprnavBrowserTabThreads({
      localEnvironmentId,
      slots: [PR_SLOT],
      threads: [
        thread("a"),
        thread("b", { branch: null }),
        thread("c", { branch: null }),
        thread("d", { archivedAt: "2026-01-01T00:00:00.000Z" }),
        thread("e", { environmentId: EnvironmentId.make("remote") }),
      ] as never,
      projects: [project] as never,
      defaults: DEFAULT_PROJECT_HYPRNAV_SETTINGS,
      groupingSettings: GROUPING,
      history: new Map([[staleKey, [6]]]),
    });
    expect(threads).toEqual([
      {
        projectRoot: "/repo",
        worktreePath: "/repo/wt/a",
        threadId: "a",
        threadTitle: "Thread a",
        projectTitle: "Repo",
        worktreeTitle: "feature/a",
        browserTabs: [PR_TAB],
        clearBrowserTabs: [],
        bindingSlots: [8],
      },
      expect.objectContaining({ threadId: "b", browserTabs: [], clearBrowserTabs: [6] }),
    ]);
  });
});

describe("buildHyprnavBrowserTabThreads with duplicate project records", () => {
  it("lets the retained record's thread binding own the slot", () => {
    const localEnvironmentId = EnvironmentId.make("local");
    const record = {
      environmentId: localEnvironmentId,
      title: "Repo",
      workspaceRoot: "/repo",
      repositoryIdentity: null,
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-04-01T00:00:00.000Z",
    };
    const stale = {
      ...record,
      id: ProjectId.make("project-stale"),
      hyprnav: null,
      updatedAt: "2026-04-18T00:00:00.000Z",
    };
    const retained = {
      ...record,
      id: ProjectId.make("project-retained"),
      updatedAt: "2026-04-20T00:00:00.000Z",
      hyprnav: {
        bindings: [
          {
            id: "pr",
            slot: PR_SLOT.slot,
            scope: "thread" as const,
            workspace: { mode: "managed" as const },
            action: "nothing" as const,
          },
        ],
      },
    };
    const threads = buildHyprnavBrowserTabThreads({
      localEnvironmentId,
      slots: [PR_SLOT],
      threads: [
        {
          environmentId: localEnvironmentId,
          id: ThreadId.make("a"),
          projectId: stale.id,
          title: "Thread a",
          branch: "feature/a",
          worktreePath: "/repo/wt/a",
          archivedAt: null,
        },
      ] as never,
      projects: [stale, retained] as never,
      defaults: DEFAULT_PROJECT_HYPRNAV_SETTINGS,
      groupingSettings: GROUPING,
      history: new Map(),
    });
    // The binding wins: no browser tab is attached and nothing was attached before.
    expect(threads).toEqual([]);
  });
});

describe("buildHyprnavBrowserTabThreads with checkout slots", () => {
  it("sends the worktree path, else the project root", () => {
    const localEnvironmentId = EnvironmentId.make("local");
    const project = {
      environmentId: localEnvironmentId,
      id: ProjectId.make("project-1"),
      title: "Repo",
      workspaceRoot: "/repo",
      hyprnav: null,
    };
    const base = {
      environmentId: localEnvironmentId,
      projectId: project.id,
      title: "Thread",
      branch: null,
      archivedAt: null,
    };
    const threads = buildHyprnavBrowserTabThreads({
      localEnvironmentId,
      slots: [CHECKOUT_SLOT],
      threads: [
        { ...base, id: ThreadId.make("wt"), worktreePath: "/repo/wt/a" },
        { ...base, id: ThreadId.make("root"), worktreePath: null },
      ] as never,
      projects: [project] as never,
      defaults: DEFAULT_PROJECT_HYPRNAV_SETTINGS,
      groupingSettings: GROUPING,
      history: new Map(),
    });
    expect(threads.map((thread) => thread.browserTabs[0]?.value)).toEqual(["/repo/wt/a", "/repo"]);
  });
});

describe("browser slot settings draft", () => {
  it("round-trips saved slots and validates edits", () => {
    const draft = browserSlotDraftFromSettings([PR_SLOT]);
    expect(parseHyprnavBrowserSlotsDraft(draft)).toEqual({ slots: [PR_SLOT], message: null });
    expect(parseHyprnavBrowserSlotsDraft([...draft, { ...draft[0]!, key: "dup" }]).message).toMatch(
      /own slot number/u,
    );
    expect(parseHyprnavBrowserSlotsDraft([{ ...draft[0]!, workspace: "x" }]).message).toMatch(
      /workspace/u,
    );
    expect(parseHyprnavBrowserSlotsDraft([{ ...draft[0]!, url: " " }]).slots).toBeNull();
  });
});
