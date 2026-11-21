// @effect-diagnostics nodeBuiltinImport:off
import type * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";

import { describe, expect, it, vi } from "vite-plus/test";

import {
  extractWorktreePathFromStdout,
  parseOpenWorktreeTerminalEntries,
  resolveWorktreeTerminalScriptPath,
  WorktreeTerminalLauncher,
} from "./WorktreeTerminal.ts";

class Stream extends NodeEvents.EventEmitter {
  setEncoding(): this {
    return this;
  }
}

function child() {
  const value = new NodeEvents.EventEmitter() as NodeEvents.EventEmitter & {
    stdout: Stream;
    stderr: Stream;
    stdin: null;
    kill: ReturnType<typeof vi.fn>;
  };
  value.stdout = new Stream();
  value.stderr = new Stream();
  value.stdin = null;
  value.kill = vi.fn(() => true);
  return value;
}

describe("WorktreeTerminalLauncher", () => {
  it("resolves electron-builder and Nix packaged helper layouts", () => {
    const path = { join: (...segments: string[]) => segments.join("/") };
    const packaged = {
      appRoot: "/opt/t3code/app",
      isPackaged: true,
      path,
      resourcesPath: "/opt/t3code/resources",
    } as never;

    expect(
      resolveWorktreeTerminalScriptPath(packaged, (candidate) => candidate.includes("resources")),
    ).toBe("/opt/t3code/resources/ghostty-worktree.cjs");
    expect(
      resolveWorktreeTerminalScriptPath(packaged, (candidate) =>
        candidate.includes("dist-electron"),
      ),
    ).toBe("/opt/t3code/app/apps/desktop/dist-electron/ghostty-worktree-entry.cjs");
  });

  it("parses launcher output", () => {
    expect(extractWorktreePathFromStdout("pid=1 workspace=4 worktree=/repo/wt/a\n")).toBe(
      "/repo/wt/a",
    );
    expect(parseOpenWorktreeTerminalEntries('[{"worktreePath":"/repo/wt/a"}]')).toEqual([
      { worktreePath: "/repo/wt/a" },
    ]);
  });

  it("opens through the Wayland Ghostty worktree script", async () => {
    const process = child();
    const spawn = vi.fn(() => process as unknown as NodeChildProcess.ChildProcess);
    const launcher = new WorktreeTerminalLauncher({
      spawn: spawn as typeof NodeChildProcess.spawn,
      runtimeExecutable: "/opt/t3code/electron",
      runtimeEnv: { WAYLAND_DISPLAY: "wayland-1" },
      commandAvailable: (command) => command === "tmux",
    });
    const result = launcher.open({
      cwd: "/repo/wt/a",
      scriptPath: "/opt/t3code/resources/ghostty-worktree.cjs",
    });
    process.stdout.emit("data", "pid=1 workspace=4 worktree=/repo/wt/a\n");
    process.emit("close", 0, null);
    await expect(result).resolves.toEqual({ worktreePath: "/repo/wt/a" });
    expect(spawn).toHaveBeenCalledWith(
      "/opt/t3code/electron",
      ["/opt/t3code/resources/ghostty-worktree.cjs", "--exec", "exec tmux"],
      expect.objectContaining({
        env: { WAYLAND_DISPLAY: "wayland-1", ELECTRON_RUN_AS_NODE: "1" },
      }),
    );
  });

  it("reads the hydrated process environment when spawning", async () => {
    const process = child();
    const spawn = vi.fn(() => process as unknown as NodeChildProcess.ChildProcess);
    let runtimeEnv: NodeJS.ProcessEnv = { PATH: "/pre-hydration", SHELL: "/bin/zsh" };
    const launcher = new WorktreeTerminalLauncher({
      spawn: spawn as typeof NodeChildProcess.spawn,
      runtimeExecutable: "/opt/t3code/electron",
      runtimeEnv: () => runtimeEnv,
    });
    runtimeEnv = { PATH: "/login-shell/bin", SHELL: "/bin/zsh" };

    const result = launcher.open({ cwd: "/repo", scriptPath: "/helper.cjs" });
    process.stdout.emit("data", "pid=1 workspace=4 worktree=/re");
    process.emit("exit", 0, null);
    process.stdout.emit("data", "po\n");
    process.emit("close", 0, null);
    await expect(result).resolves.toEqual({ worktreePath: "/repo" });
    expect(spawn).toHaveBeenCalledWith(
      "/opt/t3code/electron",
      ["/helper.cjs", "--exec", "exec '/bin/zsh'"],
      expect.objectContaining({
        env: {
          PATH: "/login-shell/bin",
          SHELL: "/bin/zsh",
          ELECTRON_RUN_AS_NODE: "1",
        },
      }),
    );
  });

  it("waits for list output to close before parsing", async () => {
    const process = child();
    const launcher = new WorktreeTerminalLauncher({
      spawn: vi.fn(() => process as unknown as NodeChildProcess.ChildProcess) as never,
      runtimeExecutable: "/opt/t3code/electron",
    });
    const result = launcher.list("/opt/t3code/helper.cjs");
    process.stdout.emit("data", '[{"worktreePath":"/repo');
    process.emit("exit", 0, null);
    process.stdout.emit("data", '/wt/a"}]');
    process.emit("close", 0, null);
    await expect(result).resolves.toEqual([{ worktreePath: "/repo/wt/a" }]);
  });

  it("kills a helper that exceeds its bounded lifetime", async () => {
    const process = child();
    const launcher = new WorktreeTerminalLauncher({
      spawn: vi.fn(() => process as unknown as NodeChildProcess.ChildProcess) as never,
      timeoutMs: 1,
    });
    await expect(launcher.list("/opt/t3code/helper.cjs")).rejects.toThrow(
      "Launcher timed out after 1ms.",
    );
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
