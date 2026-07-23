// @effect-diagnostics nodeBuiltinImport:off
import type * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";

import { DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildHyprnavEnvironmentIds,
  buildEditorCommand,
  buildHyprnavCorkdiffConnectionUpdateExpression,
  createHyprnavCorkdiffNvimServerAddress,
  expandHyprnavCommandTemplate,
  HyprnavEnvironmentManager,
  normalizeClearBindings,
} from "./HyprnavEnvironment.ts";

class MockStream extends NodeEvents.EventEmitter {
  readonly writes: string[] = [];
  setEncoding(): this {
    return this;
  }
  end(value?: string): void {
    if (value) this.writes.push(value);
  }
}

class MockChild extends NodeEvents.EventEmitter {
  readonly stdout = new MockStream();
  readonly stderr = new MockStream();
  readonly stdin = new MockStream();
  kill(): boolean {
    return true;
  }
  succeed(): void {
    this.emit("exit", 0, null);
  }
}

function spawnHarness() {
  const children: MockChild[] = [];
  const calls: Array<{
    readonly args: readonly string[];
    readonly child: MockChild;
  }> = [];
  const spawn = vi.fn((_command: string, args: readonly string[]) => {
    const child = new MockChild();
    children.push(child);
    calls.push({ args, child });
    return child as unknown as NodeChildProcess.ChildProcess;
  });
  return { spawn, calls, children };
}

describe("Hyprnav helpers", () => {
  it("builds stable nested environment ids and normalizes scoped clears", () => {
    expect(
      buildHyprnavEnvironmentIds({
        projectRoot: "/repo",
        worktreePath: "/repo/wt/a",
        threadId: "thread-1",
      }),
    ).toMatchObject({
      projectEnvId: "p.816fc349d3fa",
      threadEnvId: expect.stringMatching(/\.t\.thread-1$/u),
      targetPath: "/repo/wt/a",
    });
    expect(
      normalizeClearBindings([
        { scope: "worktree", slot: 2 },
        { scope: "worktree", slot: 2 },
        { scope: "project", slot: 1 },
      ]),
    ).toEqual([
      { scope: "project", slot: 1 },
      { scope: "worktree", slot: 2 },
    ]);
  });

  it("rejects unavailable command placeholders", () => {
    expect(
      expandHyprnavCommandTemplate("{corkdiffLaunchCommand}", {
        projectRoot: "/repo",
        targetPath: "/repo",
        threadId: null,
        corkdiffConnection: null,
      }),
    ).toEqual({
      ok: false,
      message: "Hyprnav command requires {corkdiffLaunchCommand} for this scope.",
    });
  });

  it("preserves shell parameter expansions while replacing Hyprnav placeholders", () => {
    expect(
      expandHyprnavCommandTemplate('cd "${HOME}/src" && printf "%s\\n" {projectRoot}', {
        projectRoot: "/repo with spaces",
        targetPath: "/repo with spaces",
        threadId: null,
        corkdiffConnection: null,
      }),
    ).toEqual({
      ok: true,
      command: 'cd "${HOME}/src" && printf "%s\\n" \'/repo with spaces\'',
    });
  });

  it("expands Corkdiff with the current desktop connection environment", () => {
    const result = expandHyprnavCommandTemplate("{corkdiffLaunchCommand}", {
      projectRoot: "/repo",
      targetPath: "/repo/wt/a",
      threadId: "thread-1",
      corkdiffConnection: { serverUrl: "ws://127.0.0.1/ws", token: "secret" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.command).toContain("T3CODE_TOKEN='secret'");
    expect(result.command).toContain("exec ghostty");
    expect(result.command).toContain("--listen");
    expect(result.command).not.toContain("hyprnav spawn");

    const urlTicket = expandHyprnavCommandTemplate("{corkdiffLaunchCommand}", {
      projectRoot: "/repo",
      targetPath: "/repo/wt/a",
      threadId: "thread-1",
      corkdiffConnection: { serverUrl: "ws://127.0.0.1/ws?wsTicket=fresh", token: null },
    });
    expect(urlTicket.ok).toBe(true);
    if (urlTicket.ok) expect(urlTicket.command).toContain("T3CODE_TOKEN=''");
  });

  it("builds a stable Corkdiff socket and safely encoded live connection update", () => {
    expect(
      createHyprnavCorkdiffNvimServerAddress("thread-1", {
        XDG_RUNTIME_DIR: "/run/user/1000",
      }),
    ).toBe("/run/user/1000/t3code-corkdiff-4b0a5fefc328.sock");
    const expression = buildHyprnavCorkdiffConnectionUpdateExpression({
      serverUrl: "ws://127.0.0.1/ws?wsTicket=fresh",
      token: null,
    });
    expect(expression).toContain("config.server_url=value.serverUrl");
    expect(expression).toContain("wsTicket=fresh");
  });

  it("uses the available fallback editor command and Linux file manager", () => {
    expect(buildEditorCommand("/repo", "zed", (command) => command === "zeditor")).toBe(
      "'zeditor' '/repo'",
    );
    expect(buildEditorCommand("/repo", "file-manager", (command) => command === "xdg-open")).toBe(
      "'xdg-open' '/repo'",
    );
  });
});

describe("HyprnavEnvironmentManager", () => {
  it("atomically ensures scopes, clears names, assigns actions, then locks", async () => {
    const harness = spawnHarness();
    const manager = new HyprnavEnvironmentManager({
      spawn: harness.spawn as unknown as typeof NodeChildProcess.spawn,
      resolvePath: (path) => path,
      realpathSync: (path) => path,
      commandAvailable: (command) => command === "cursor",
    });
    const result = manager.sync({
      projectRoot: "/repo",
      worktreePath: "/repo/wt/a",
      threadId: "thread-1",
      threadTitle: "Implement runtime",
      preferredEditor: "cursor",
      hyprnav: {
        bindings: [
          {
            id: "terminal",
            slot: 1,
            scope: "worktree",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            name: "Terminal",
            action: "worktree-terminal",
          },
          {
            id: "editor",
            slot: 2,
            scope: "project",
            workspace: { mode: "absolute", workspaceId: 7 },
            action: "open-favorite-editor",
          },
          {
            id: "nothing",
            slot: 3,
            scope: "thread",
            workspace: DEFAULT_PROJECT_HYPRNAV_WORKSPACE_TARGET,
            action: "nothing",
          },
        ],
      },
      clearBindings: [{ scope: "worktree", slot: 9 }],
      clearNames: [{ scope: "project", slot: 8 }],
      lock: true,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    const payload = JSON.parse(harness.calls[0]!.child.stdin.writes.join("")) as {
      operations: Array<Record<string, unknown>>;
    };
    expect(payload.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          op: "env_ensure",
          title: "Implement runtime",
        }),
        expect.objectContaining({ op: "slot_name_clear", slot: 8 }),
        expect.objectContaining({ op: "slot_clear", slot: 9 }),
        expect.objectContaining({
          op: "slot_assign",
          assignment_mode: { mode: "fixed", workspace_id: 7 },
        }),
        expect.objectContaining({
          op: "slot_command_set",
          slot: 3,
          argv: ["sh", "-lc", ":"],
        }),
      ]),
    );
    harness.children[0]!.succeed();
    await vi.waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]!.args[0]).toBe("lock");
    harness.children[1]!.succeed();
    await expect(result).resolves.toEqual({
      status: "ok",
      message: null,
      appliedScopes: ["worktree", "project", "thread"],
    });
  });

  it("globally orders lock-bearing synchronization across thread switches", async () => {
    const harness = spawnHarness();
    const manager = new HyprnavEnvironmentManager({
      spawn: harness.spawn as unknown as typeof NodeChildProcess.spawn,
      resolvePath: (path) => path,
      realpathSync: (path) => path,
    });
    const request = (threadId: string) =>
      manager.sync({
        projectRoot: "/repo",
        threadId,
        hyprnav: {
          bindings: [
            {
              id: threadId,
              slot: 1,
              scope: "thread",
              workspace: { mode: "managed" },
              action: "nothing",
            },
          ],
        },
        lock: true,
      });

    const first = request("thread-old");
    const second = request("thread-new");
    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    harness.children[0]!.succeed();
    await vi.waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]!.args).toEqual(["lock", expect.stringMatching(/\.t\.thread-old$/u)]);
    harness.children[1]!.succeed();
    await vi.waitFor(() => expect(harness.calls).toHaveLength(3));
    expect(harness.calls[2]!.args).toEqual(["batch", "--stdin"]);
    harness.children[2]!.succeed();
    await vi.waitFor(() => expect(harness.calls).toHaveLength(4));
    expect(harness.calls[3]!.args).toEqual(["lock", expect.stringMatching(/\.t\.thread-new$/u)]);
    harness.children[3]!.succeed();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "ok", message: null, appliedScopes: ["thread"] },
      { status: "ok", message: null, appliedScopes: ["thread"] },
    ]);
  });

  it("assigns a fresh slot before clearing its previous display name", async () => {
    const harness = spawnHarness();
    const manager = new HyprnavEnvironmentManager({
      spawn: harness.spawn as unknown as typeof NodeChildProcess.spawn,
      resolvePath: (path) => path,
      realpathSync: (path) => path,
    });
    const result = manager.sync({
      projectRoot: "/repo",
      hyprnav: {
        bindings: [
          {
            id: "terminal",
            slot: 4,
            scope: "project",
            workspace: { mode: "managed" },
            action: "nothing",
          },
        ],
      },
      clearNames: [{ scope: "project", slot: 4 }],
      lock: false,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    const payload = JSON.parse(harness.calls[0]!.child.stdin.writes.join("")) as {
      operations: Array<Record<string, unknown>>;
    };
    expect(payload.operations.map((operation) => operation.op)).toEqual([
      "env_ensure",
      "slot_assign",
      "slot_command_set",
      "slot_name_clear",
    ]);
    harness.children[0]!.succeed();
    await expect(result).resolves.toEqual({
      status: "ok",
      message: null,
      appliedScopes: ["project"],
    });
  });

  it("refreshes a running Hyprnav-launched Corkdiff before republishing", async () => {
    const harness = spawnHarness();
    const manager = new HyprnavEnvironmentManager({
      spawn: harness.spawn as unknown as typeof NodeChildProcess.spawn,
      resolvePath: (path) => path,
      realpathSync: (path) => path,
      runtimeEnv: { XDG_RUNTIME_DIR: "/run/user/1000" },
      readSocketIdentity: () => ({ device: 1, inode: 2 }),
    });
    const result = manager.sync({
      projectRoot: "/repo",
      threadId: "thread-1",
      hyprnav: { bindings: [] },
      corkdiffConnection: {
        serverUrl: "ws://127.0.0.1/ws?wsTicket=fresh",
        token: null,
      },
      lock: false,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.spawn).toHaveBeenCalledWith(
      "nvim",
      expect.arrayContaining(["--server", "--remote-expr", "1"]),
      expect.anything(),
    );
    harness.children[0]!.succeed();
    await vi.waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]!.args).toEqual(expect.arrayContaining(["--server", "--remote-expr"]));
    expect(harness.calls[1]!.args).not.toContain("1");
    harness.children[1]!.succeed();
    await expect(result).resolves.toEqual({
      status: "ok",
      message: null,
      appliedScopes: [],
    });
  });

  it("removes an identity-matched stale Corkdiff socket and continues publication", async () => {
    const harness = spawnHarness();
    let socketExists = true;
    const unlinkSocket = vi.fn(() => {
      socketExists = false;
    });
    const manager = new HyprnavEnvironmentManager({
      spawn: harness.spawn as unknown as typeof NodeChildProcess.spawn,
      resolvePath: (path) => path,
      realpathSync: (path) => path,
      runtimeEnv: { XDG_RUNTIME_DIR: "/run/user/1000" },
      readSocketIdentity: () => (socketExists ? { device: 3, inode: 4 } : null),
      unlinkSocket,
    });
    const result = manager.sync({
      projectRoot: "/repo",
      threadId: "thread-1",
      hyprnav: {
        bindings: [
          {
            id: "noop",
            slot: 1,
            scope: "project",
            workspace: { mode: "managed" },
            action: "nothing",
          },
        ],
      },
      corkdiffConnection: {
        serverUrl: "ws://127.0.0.1/ws?wsTicket=fresh",
        token: null,
      },
      lock: false,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    harness.children[0]!.emit("exit", 1, null);
    await vi.waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(unlinkSocket).toHaveBeenCalledOnce();
    expect(harness.spawn).toHaveBeenLastCalledWith(
      "hyprnav",
      ["batch", "--stdin"],
      expect.anything(),
    );
    harness.children[1]!.succeed();
    await expect(result).resolves.toEqual({
      status: "ok",
      message: null,
      appliedScopes: ["project"],
    });
  });

  it("reports a missing Hyprnav binary without throwing", async () => {
    const manager = new HyprnavEnvironmentManager({
      spawn: (() => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }) as typeof NodeChildProcess.spawn,
    });
    await expect(manager.lock({ envId: "p.repo" })).resolves.toEqual({
      status: "unavailable",
      message: "hyprnav is not installed or not available in PATH.",
    });
  });

  it("reports Hyprnav stdin pipe failures without an unhandled stream error", async () => {
    const harness = spawnHarness();
    const manager = new HyprnavEnvironmentManager({
      spawn: harness.spawn as unknown as typeof NodeChildProcess.spawn,
      resolvePath: (path) => path,
      realpathSync: (path) => path,
    });
    const result = manager.sync({
      projectRoot: "/repo",
      hyprnav: {
        bindings: [
          {
            id: "terminal",
            slot: 1,
            scope: "project",
            workspace: { mode: "managed" },
            action: "nothing",
          },
        ],
      },
      lock: false,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    harness.children[0]!.stdin.emit(
      "error",
      Object.assign(new Error("broken pipe"), { code: "EPIPE" }),
    );
    await expect(result).resolves.toEqual({
      status: "error",
      message: "broken pipe",
    });
  });

  it("publishes only project operations when a worktree was removed", async () => {
    const harness = spawnHarness();
    const manager = new HyprnavEnvironmentManager({
      spawn: harness.spawn as unknown as typeof NodeChildProcess.spawn,
      realpathSync: (path) => {
        if (path === "/repo/worktrees/removed") {
          throw Object.assign(new Error("worktree missing"), {
            code: "ENOENT",
          });
        }
        return path;
      },
    });
    const result = manager.sync({
      projectRoot: "/repo",
      worktreePath: "/repo/worktrees/removed",
      threadId: "thread-1",
      hyprnav: {
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
            slot: 3,
            scope: "thread",
            workspace: { mode: "managed" },
            action: "nothing",
          },
        ],
      },
      clearBindings: [
        { scope: "project", slot: 4 },
        { scope: "worktree", slot: 5 },
      ],
      clearNames: [
        { scope: "project", slot: 6 },
        { scope: "thread", slot: 7 },
      ],
      lock: true,
    });

    await vi.waitFor(() => expect(harness.calls).toHaveLength(1));
    const payload = JSON.parse(harness.calls[0]!.child.stdin.writes.join("")) as {
      operations: Array<Record<string, unknown>>;
    };
    expect(payload.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: "env_ensure", cwd: "/repo" }),
        expect.objectContaining({ op: "slot_assign", slot: 1 }),
        expect.objectContaining({ op: "slot_clear", slot: 4 }),
        expect.objectContaining({ op: "slot_name_clear", slot: 6 }),
      ]),
    );
    expect(
      payload.operations.filter(
        (operation) => typeof operation.slot === "number" && [2, 3, 5, 7].includes(operation.slot),
      ),
    ).toEqual([]);
    harness.children[0]!.succeed();
    await expect(result).resolves.toEqual({
      status: "ok",
      message: null,
      appliedScopes: ["project"],
    });
    expect(harness.calls).toHaveLength(1);
  });

  it("preserves missing project roots and non-ENOENT worktree failures", async () => {
    const request = {
      projectRoot: "/repo",
      worktreePath: "/repo/worktrees/feature",
      hyprnav: { bindings: [] },
      lock: false,
    } as const;
    const missingRoot = new HyprnavEnvironmentManager({
      realpathSync: (path) => {
        if (path === "/repo") throw Object.assign(new Error("project missing"), { code: "ENOENT" });
        return path;
      },
    });
    const unreadableWorktree = new HyprnavEnvironmentManager({
      realpathSync: (path) => {
        if (path === request.worktreePath) {
          throw Object.assign(new Error("worktree denied"), { code: "EACCES" });
        }
        return path;
      },
    });

    await expect(missingRoot.sync(request)).resolves.toEqual({
      status: "error",
      message: "project missing",
    });
    await expect(unreadableWorktree.sync(request)).resolves.toEqual({
      status: "error",
      message: "worktree denied",
    });
  });
});
