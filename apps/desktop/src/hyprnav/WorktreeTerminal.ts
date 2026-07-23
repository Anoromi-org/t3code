// @effect-diagnostics globalTimers:off nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeTimers from "node:timers";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

const ASSIGNMENT = /^pid=\d+\s+workspace=\d+\s+worktree=(.+)$/u;
const HELPER_TIMEOUT_MS = 20_000;

export class WorktreeTerminalCommandError extends Schema.TaggedErrorClass<WorktreeTerminalCommandError>()(
  "WorktreeTerminalCommandError",
  { operation: Schema.Literals(["open", "list"]), cause: Schema.Defect() },
) {}

export function extractWorktreePathFromStdout(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const match = ASSIGNMENT.exec(line.trim());
    return match?.[1]?.trim() || null;
  }
  return null;
}

export function parseOpenWorktreeTerminalEntries(
  stdout: string,
): ReadonlyArray<{ readonly worktreePath: string }> {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new Error("Expected an array of worktree terminals.");
  return parsed.map((entry, index) => {
    const worktreePath =
      typeof entry === "object" && entry !== null && "worktreePath" in entry
        ? entry.worktreePath
        : null;
    if (typeof worktreePath !== "string" || worktreePath.trim().length === 0) {
      throw new Error(`Invalid worktree path at index ${String(index)}.`);
    }
    return { worktreePath: worktreePath.trim() };
  });
}

interface LauncherOptions {
  readonly spawn?: typeof NodeChildProcess.spawn;
  readonly runtimeExecutable?: string;
  readonly runtimeEnv?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
  readonly commandAvailable?: (command: string) => boolean;
  readonly timeoutMs?: number;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandExists(command: string, env: NodeJS.ProcessEnv): boolean {
  for (const directory of (env.PATH ?? "").split(NodePath.delimiter)) {
    if (!directory) continue;
    try {
      NodeFS.accessSync(NodePath.join(directory, command), NodeFS.constants.X_OK);
      return true;
    } catch {
      // Continue through PATH candidates.
    }
  }
  return false;
}

export function resolveTerminalExecCommand(
  env: NodeJS.ProcessEnv,
  commandAvailable: (command: string) => boolean = (command) => commandExists(command, env),
): string {
  if (commandAvailable("tmux")) return "exec tmux";
  const shell = env.SHELL?.trim();
  return shell ? `exec ${quoteShellArg(shell)}` : "exec sh";
}

export function resolveWorktreeTerminalScriptPath(
  environment: Pick<
    DesktopEnvironment.DesktopEnvironment["Service"],
    "appRoot" | "isPackaged" | "path" | "resourcesPath"
  >,
  fileExists: (path: string) => boolean = NodeFS.existsSync,
): string {
  const developmentPath = environment.path.join(
    environment.appRoot,
    "apps/desktop/dist-electron/ghostty-worktree-entry.cjs",
  );
  if (!environment.isPackaged) return developmentPath;

  const packagePaths = [
    environment.path.join(environment.resourcesPath, "ghostty-worktree.cjs"),
    developmentPath,
  ];
  return packagePaths.find(fileExists) ?? packagePaths[0]!;
}

export class WorktreeTerminalLauncher {
  private readonly spawn: typeof NodeChildProcess.spawn;
  private readonly runtimeExecutable: string;
  private readonly runtimeEnv: () => NodeJS.ProcessEnv;
  private readonly commandAvailable: ((command: string) => boolean) | undefined;
  private readonly timeoutMs: number;

  constructor(options: LauncherOptions = {}) {
    this.spawn = options.spawn ?? NodeChildProcess.spawn;
    this.runtimeExecutable = options.runtimeExecutable ?? process.execPath;
    this.commandAvailable = options.commandAvailable;
    this.timeoutMs = options.timeoutMs ?? HELPER_TIMEOUT_MS;
    const runtimeEnv = options.runtimeEnv;
    this.runtimeEnv =
      typeof runtimeEnv === "function"
        ? runtimeEnv
        : runtimeEnv === undefined
          ? () => process.env
          : () => runtimeEnv;
  }

  open(input: {
    readonly cwd: string;
    readonly scriptPath: string;
  }): Promise<{ readonly worktreePath: string }> {
    const cwd = input.cwd.trim();
    if (!cwd) {
      return Promise.reject(
        new Error("Worktree terminal launch requires a valid working directory."),
      );
    }
    const runtimeEnv = this.runtimeEnv();
    return this.run(
      [input.scriptPath, "--exec", resolveTerminalExecCommand(runtimeEnv, this.commandAvailable)],
      cwd,
      runtimeEnv,
    ).then(({ stdout }) => {
      const worktreePath = extractWorktreePathFromStdout(stdout);
      if (!worktreePath) throw new Error("Launcher did not report its worktree assignment.");
      return { worktreePath };
    });
  }

  list(scriptPath: string): Promise<ReadonlyArray<{ readonly worktreePath: string }>> {
    const runtimeEnv = this.runtimeEnv();
    return this.run([scriptPath, "list-open"], NodePath.dirname(scriptPath), runtimeEnv).then(
      ({ stdout }) => parseOpenWorktreeTerminalEntries(stdout),
    );
  }

  private run(
    args: readonly string[],
    cwd: string,
    runtimeEnv: NodeJS.ProcessEnv,
  ): Promise<{ readonly stdout: string; readonly stderr: string }> {
    const child = this.spawn(this.runtimeExecutable, [...args], {
      cwd,
      env: { ...runtimeEnv, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = NodeTimers.setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error(`Launcher timed out after ${String(this.timeoutMs)}ms.`));
      }, this.timeoutMs);
      timer.unref?.();
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        NodeTimers.clearTimeout(timer);
        if (error) reject(error);
        else resolve({ stdout, stderr });
      };
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => (stdout += chunk));
      child.stderr?.on("data", (chunk: string) => (stderr += chunk));
      child.once("error", (error) => finish(error));
      child.once("close", (code, signal) => {
        if (code === 0) finish();
        else {
          finish(
            new Error(
              stderr.trim() ||
                (signal
                  ? `Launcher exited with signal ${signal}.`
                  : `Launcher exited with code ${String(code)}.`),
            ),
          );
        }
      });
    });
  }
}

export class WorktreeTerminal extends Context.Service<
  WorktreeTerminal,
  {
    readonly open: (
      cwd: string,
    ) => Effect.Effect<{ readonly worktreePath: string }, WorktreeTerminalCommandError>;
    readonly list: Effect.Effect<
      ReadonlyArray<{ readonly worktreePath: string }>,
      WorktreeTerminalCommandError
    >;
  }
>()("@t3tools/desktop/hyprnav/WorktreeTerminal") {}

export const layer = Layer.effect(
  WorktreeTerminal,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const launcher = new WorktreeTerminalLauncher();
    const scriptPath = resolveWorktreeTerminalScriptPath(environment);
    return WorktreeTerminal.of({
      open: (cwd) =>
        Effect.tryPromise({
          try: () => launcher.open({ cwd, scriptPath }),
          catch: (cause) => new WorktreeTerminalCommandError({ operation: "open", cause }),
        }),
      list: Effect.tryPromise({
        try: () => launcher.list(scriptPath),
        catch: (cause) => new WorktreeTerminalCommandError({ operation: "list", cause }),
      }),
    });
  }),
);
