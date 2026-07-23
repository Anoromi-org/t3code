import { PRIMARY_LOCAL_ENVIRONMENT_ID, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  attachHyprnavWebSocketTicket,
  computeActiveHyprnavCleanup,
  createCancelableHyprnavDelay,
  createActiveHyprnavRequestKey,
  HYPRNAV_CREDENTIAL_REFRESH_DELAY_MS,
  hyprnavCredentialRefreshDelay,
  type HyprnavPublicationHistory,
  isHyprnavDesktopRuntimeAvailable,
  loadHyprnavPublicationHistory,
  markActiveHyprnavPublicationAttempt,
  preferredEditorForHyprnav,
  persistHyprnavPublicationHistory,
  publishHyprnavRequests,
  recordActiveHyprnavPublication,
  resolveActiveHyprnavSyncTarget,
  resolveEffectiveHyprnavSettings,
  syncHyprnavWithRetry,
} from "./hyprnavRuntime";

const request = {
  projectRoot: "/repo",
  worktreePath: "/repo/worktree",
  threadId: "thread-1",
  threadTitle: "Thread",
  hyprnav: { bindings: [] },
  lock: true,
} as const;

describe("hyprnavRuntime", () => {
  it("keys publication by semantic inputs instead of projection object identity", () => {
    const input = {
      target: {
        projectRoot: "/repo",
        worktreePath: "/repo/worktree",
        threadId: ThreadId.make("thread-1"),
        threadTitle: "Thread",
      },
      settings: { bindings: [] },
      availableEditors: ["zed" as const],
    };
    expect(createActiveHyprnavRequestKey(input)).toBe(
      createActiveHyprnavRequestKey({
        target: { ...input.target },
        settings: { ...input.settings },
        availableEditors: [...input.availableEditors],
      }),
    );
  });

  it("retries transient results and returns the final result", async () => {
    const sync = vi
      .fn()
      .mockResolvedValueOnce({ status: "unavailable", message: "starting" })
      .mockResolvedValueOnce({ status: "error", message: "temporary" })
      .mockResolvedValueOnce({ status: "ok", message: null });
    const wait = vi.fn(async () => undefined);
    await expect(
      syncHyprnavWithRetry({ sync, request, retryDelaysMs: [10, 20], wait }),
    ).resolves.toEqual({ status: "ok", message: null });
    expect(sync).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[10], [20]]);

    const failedSync = vi.fn(async () => ({
      status: "unavailable" as const,
      message: "missing",
    }));
    await expect(
      syncHyprnavWithRetry({
        sync: failedSync,
        request,
        retryDelaysMs: [1],
        wait,
      }),
    ).resolves.toEqual({ status: "unavailable", message: "missing" });
    expect(failedSync).toHaveBeenCalledTimes(2);
  });

  it("does not retry an obsolete publication after the active thread changes", async () => {
    let current = true;
    const sync = vi.fn(async () => ({
      status: "error" as const,
      message: "temporary",
    }));
    const onBeforeSync = vi.fn();
    const wait = vi.fn(async () => {
      current = false;
    });
    await expect(
      syncHyprnavWithRetry({
        sync,
        request,
        retryDelaysMs: [1],
        wait,
        isCurrent: () => current,
        onBeforeSync,
      }),
    ).resolves.toEqual({
      status: "error",
      message: "Hyprnav publication superseded.",
    });
    expect(sync).toHaveBeenCalledOnce();
    expect(onBeforeSync).toHaveBeenCalledOnce();
  });

  it("resolves a preferred editor only when a binding needs it", () => {
    const resolve = vi.fn(() => "vscode" as const);
    expect(preferredEditorForHyprnav([request], ["vscode"], resolve)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(
      preferredEditorForHyprnav(
        [
          {
            ...request,
            hyprnav: {
              bindings: [
                {
                  id: "editor",
                  slot: 2,
                  scope: "worktree",
                  workspace: { mode: "managed" },
                  action: "open-favorite-editor",
                },
              ],
            },
          },
        ],
        ["vscode"],
        resolve,
      ),
    ).toBe("vscode");
  });

  it("publishes enriched requests with one refreshed Corkdiff connection", async () => {
    const sync = vi.fn(async () => ({ status: "ok" as const, message: null }));
    vi.stubGlobal("window", {
      desktopBridge: { syncHyprnavEnvironment: sync },
    });
    try {
      const resolveConnection = vi.fn(async () => ({
        serverUrl: "ws://127.0.0.1/ws?wsTicket=fresh",
        token: null,
      }));
      const resolveEditor = vi.fn(() => "vscode" as const);
      await expect(
        publishHyprnavRequests({
          requests: [
            {
              ...request,
              hyprnav: {
                bindings: [
                  {
                    id: "editor",
                    slot: 2,
                    scope: "worktree",
                    workspace: { mode: "managed" },
                    action: "open-favorite-editor",
                  },
                  {
                    id: "corkdiff",
                    slot: 8,
                    scope: "thread",
                    workspace: { mode: "managed" },
                    action: "shell-command",
                    command: "{corkdiffLaunchCommand}",
                  },
                ],
              },
            },
          ],
          availableEditors: ["vscode"],
          resolvePreferredEditor: resolveEditor,
          resolveCorkdiffConnection: resolveConnection,
        }),
      ).resolves.toEqual({
        status: "ok",
        message: null,
        appliedScopes: ["worktree", "thread"],
      });
      expect(resolveConnection).toHaveBeenCalledOnce();
      expect(sync).toHaveBeenCalledWith(
        expect.objectContaining({
          preferredEditor: "vscode",
          corkdiffConnection: {
            serverUrl: "ws://127.0.0.1/ws?wsTicket=fresh",
            token: null,
          },
        }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops a publication superseded while resolving Corkdiff credentials", async () => {
    const sync = vi.fn(async () => ({ status: "ok" as const, message: null }));
    vi.stubGlobal("window", {
      desktopBridge: { syncHyprnavEnvironment: sync },
    });
    let current = true;
    try {
      await expect(
        publishHyprnavRequests({
          requests: [
            {
              ...request,
              hyprnav: {
                bindings: [
                  {
                    id: "corkdiff",
                    slot: 8,
                    scope: "thread",
                    workspace: { mode: "managed" },
                    action: "shell-command",
                    command: "{corkdiffLaunchCommand}",
                  },
                ],
              },
            },
          ],
          availableEditors: [],
          resolvePreferredEditor: () => null,
          resolveCorkdiffConnection: async () => {
            current = false;
            return {
              serverUrl: "ws://127.0.0.1/ws?wsTicket=fresh",
              token: null,
            };
          },
          isCurrent: () => current,
        }),
      ).resolves.toEqual({
        status: "error",
        message: "Hyprnav publication superseded.",
      });
      expect(sync).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("targets only matching primary-local active threads and resolves inheritance", () => {
    const project = {
      environmentId: PRIMARY_LOCAL_ENVIRONMENT_ID,
      id: ProjectId.make("project-1"),
      workspaceRoot: "/repo",
    };
    const thread = {
      environmentId: PRIMARY_LOCAL_ENVIRONMENT_ID,
      id: ThreadId.make("thread-1"),
      projectId: ProjectId.make("project-1"),
      title: "Thread",
      worktreePath: "/repo/worktree",
    };
    expect(resolveActiveHyprnavSyncTarget({ project, thread } as never)).toEqual({
      projectRoot: "/repo",
      worktreePath: "/repo/worktree",
      threadId: ThreadId.make("thread-1"),
      threadTitle: "Thread",
    });
    expect(
      resolveActiveHyprnavSyncTarget({
        project,
        thread: { ...thread, environmentId: "remote" },
      } as never),
    ).toBeNull();
    const defaults = { bindings: [] };
    expect(resolveEffectiveHyprnavSettings(null, defaults)).toBe(defaults);
    const override = { bindings: [] };
    expect(resolveEffectiveHyprnavSettings(override, defaults)).toBe(override);
  });

  it("tracks cleanup independently for project, worktree, and thread scopes", () => {
    const target = {
      projectRoot: "/repo",
      worktreePath: "/repo/worktree",
      threadId: ThreadId.make("thread-1"),
      threadTitle: "Thread",
    };
    const history: HyprnavPublicationHistory = new Map();
    recordActiveHyprnavPublication({
      history,
      target,
      settings: {
        bindings: [
          {
            id: "project-old",
            slot: 1,
            scope: "project",
            workspace: { mode: "managed" },
            name: "Project",
            action: "nothing",
          },
          {
            id: "worktree",
            slot: 2,
            scope: "worktree",
            workspace: { mode: "managed" },
            name: "Editor",
            action: "nothing",
          },
          {
            id: "thread-old",
            slot: 8,
            scope: "thread",
            workspace: { mode: "managed" },
            action: "nothing",
          },
        ],
      },
    });
    expect(
      computeActiveHyprnavCleanup({
        history,
        target,
        settings: {
          bindings: [
            {
              id: "project-new",
              slot: 3,
              scope: "project",
              workspace: { mode: "managed" },
              action: "nothing",
            },
            {
              id: "worktree",
              slot: 2,
              scope: "worktree",
              workspace: { mode: "managed" },
              action: "nothing",
            },
          ],
        },
      }),
    ).toEqual({
      clearBindings: [
        { scope: "project", slot: 1 },
        { scope: "thread", slot: 8 },
      ],
      clearNames: [{ scope: "worktree", slot: 2 }],
    });
    expect(
      computeActiveHyprnavCleanup({
        history,
        target: { ...target, threadId: ThreadId.make("thread-2") },
        settings: { bindings: [] },
      }),
    ).toEqual({
      clearBindings: [
        { scope: "project", slot: 1 },
        { scope: "worktree", slot: 2 },
      ],
      clearNames: [],
    });
  });

  it("retains cleanup from attempted state until a later publication is acknowledged", () => {
    const target = {
      projectRoot: "/repo",
      worktreePath: null,
      threadId: ThreadId.make("thread-1"),
      threadTitle: "Thread",
    };
    const history: HyprnavPublicationHistory = new Map();
    const initial = {
      bindings: [
        {
          id: "terminal",
          slot: 1,
          scope: "project" as const,
          workspace: { mode: "managed" as const },
          action: "nothing" as const,
        },
      ],
    };
    recordActiveHyprnavPublication({ history, target, settings: initial });
    markActiveHyprnavPublicationAttempt({
      history,
      target,
      settings: { bindings: [] },
    });

    expect(
      computeActiveHyprnavCleanup({
        history,
        target,
        settings: { bindings: [] },
      }),
    ).toEqual({
      clearBindings: [{ scope: "project", slot: 1 }],
      clearNames: [],
    });
    recordActiveHyprnavPublication({
      history,
      target,
      settings: { bindings: [] },
    });
    expect(
      computeActiveHyprnavCleanup({
        history,
        target,
        settings: { bindings: [] },
      }),
    ).toEqual({
      clearBindings: [],
      clearNames: [],
    });
  });

  it("keeps cleanup pending for scopes omitted by stale-target recovery", () => {
    const target = {
      projectRoot: "/repo",
      worktreePath: "/repo/worktree",
      threadId: ThreadId.make("thread-1"),
      threadTitle: "Thread",
    };
    const history: HyprnavPublicationHistory = new Map();
    recordActiveHyprnavPublication({
      history,
      target,
      settings: {
        bindings: [
          {
            id: "project",
            slot: 1,
            scope: "project",
            workspace: { mode: "managed" },
            action: "nothing",
          },
          {
            id: "worktree",
            slot: 2,
            scope: "worktree",
            workspace: { mode: "managed" },
            action: "nothing",
          },
          {
            id: "thread",
            slot: 8,
            scope: "thread",
            workspace: { mode: "managed" },
            action: "nothing",
          },
        ],
      },
    });

    recordActiveHyprnavPublication({
      history,
      target,
      settings: { bindings: [] },
      appliedScopes: ["project"],
    });

    expect(
      computeActiveHyprnavCleanup({
        history,
        target,
        settings: { bindings: [] },
      }),
    ).toEqual({
      clearBindings: [
        { scope: "worktree", slot: 2 },
        { scope: "thread", slot: 8 },
      ],
      clearNames: [],
    });
  });

  it("detects whether the platform exposed the optional Hyprnav bridge", () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    expect(isHyprnavDesktopRuntimeAvailable()).toBe(false);
    vi.stubGlobal("window", {
      desktopBridge: { syncHyprnavEnvironment: vi.fn() },
    });
    expect(isHyprnavDesktopRuntimeAvailable()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("persists minimal publication history across renderer restarts", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const target = {
      projectRoot: "/repo",
      worktreePath: null,
      threadId: ThreadId.make("thread-1"),
      threadTitle: "Thread",
    };
    const history: HyprnavPublicationHistory = new Map();
    recordActiveHyprnavPublication({
      history,
      target,
      settings: {
        bindings: [
          {
            id: "secret-command",
            slot: 7,
            scope: "project",
            workspace: { mode: "managed" },
            name: "Named",
            action: "shell-command",
            command: "do-not-persist --token secret",
          },
        ],
      },
    });
    persistHyprnavPublicationHistory(history, storage);
    expect([...values.values()][0]).not.toContain("do-not-persist");

    const restored = loadHyprnavPublicationHistory(storage);
    expect(
      computeActiveHyprnavCleanup({
        history: restored,
        target,
        settings: { bindings: [] },
      }),
    ).toEqual({
      clearBindings: [{ scope: "project", slot: 7 }],
      clearNames: [],
    });
    values.set("t3code:hyprnav-publication-history:v1", "{broken");
    expect(loadHyprnavPublicationHistory(storage).size).toBe(0);
  });

  it("replaces legacy credentials and schedules Corkdiff refresh before ticket expiry", () => {
    expect(
      attachHyprnavWebSocketTicket(
        "ws://127.0.0.1:3000/?token=old&wsToken=older&wsTicket=leaked",
        "fresh",
      ),
    ).toBe("ws://127.0.0.1:3000/ws?token=fresh");
    expect(
      hyprnavCredentialRefreshDelay({
        bindings: [
          {
            id: "corkdiff",
            slot: 8,
            scope: "thread",
            workspace: { mode: "managed" },
            action: "shell-command",
            command: "corkdiff {corkdiffServerUrl}",
          },
        ],
      }),
    ).toBe(HYPRNAV_CREDENTIAL_REFRESH_DELAY_MS);
    expect(hyprnavCredentialRefreshDelay({ bindings: [] })).toBeNull();
    expect(HYPRNAV_CREDENTIAL_REFRESH_DELAY_MS).toBeLessThan(5 * 60_000);
  });

  it("cancels and wakes a pending credential refresh", async () => {
    vi.useFakeTimers();
    try {
      const delay = createCancelableHyprnavDelay();
      const pending = delay.wait(HYPRNAV_CREDENTIAL_REFRESH_DELAY_MS);
      expect(vi.getTimerCount()).toBe(1);
      delay.cancel();
      await expect(pending).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
