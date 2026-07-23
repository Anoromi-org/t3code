// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type {
  DesktopHyprnavCorkdiffConnectionInput,
  DesktopHyprnavLockInput,
  DesktopHyprnavScopedSlot,
  DesktopHyprnavSyncInput,
  DesktopHyprnavSyncResult,
  EditorId,
  ProjectHyprnavBinding,
  ProjectHyprnavScope,
} from "@t3tools/contracts";
import { EDITORS } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  buildCorkdiffConnectionUpdateExpression,
  buildCorkdiffGhosttyArgs,
  createCorkdiffGhosttyClassName,
  createCorkdiffNvimServerAddress,
} from "../corkdiff/ExternalCorkdiffCommand.ts";
import { resolveTerminalExecCommand } from "./WorktreeTerminal.ts";

export {
  buildCorkdiffConnectionUpdateExpression as buildHyprnavCorkdiffConnectionUpdateExpression,
  createCorkdiffNvimServerAddress as createHyprnavCorkdiffNvimServerAddress,
} from "../corkdiff/ExternalCorkdiffCommand.ts";

const CLIENT_ID = "t3code";
const COMMAND_TIMEOUT_MS = 5_000;

interface EnvironmentIds {
  readonly projectEnvId: string;
  readonly worktreeEnvId: string;
  readonly threadEnvId: string | null;
  readonly lockEnvId: string;
  readonly targetPath: string;
}

interface ResolvedBinding {
  readonly envId: string;
  readonly slot: number;
  readonly name: string | null;
  readonly workspaceId: number | null;
  readonly command: string | null;
}

type BatchOperation = Record<string, unknown> & { readonly op: string };

interface CanonicalSyncInput extends Omit<DesktopHyprnavSyncInput, "projectRoot"> {
  readonly projectRoot: string;
  readonly worktreePath: string | null;
  readonly threadId: string | null;
  readonly threadTitle: string | null;
  readonly clearBindings: readonly DesktopHyprnavScopedSlot[];
  readonly clearNames: readonly DesktopHyprnavScopedSlot[];
  readonly corkdiffConnection: DesktopHyprnavCorkdiffConnectionInput | null;
}

export interface HyprnavSocketIdentity {
  readonly device: number;
  readonly inode: number;
}

export interface HyprnavEnvironmentManagerOptions {
  readonly spawn?: typeof NodeChildProcess.spawn;
  readonly resolvePath?: (...segments: string[]) => string;
  readonly realpathSync?: (path: string) => string;
  readonly commandAvailable?: (command: string) => boolean;
  readonly readSocketIdentity?: (path: string) => HyprnavSocketIdentity | null;
  readonly unlinkSocket?: (path: string) => void;
  readonly runtimeEnv?: NodeJS.ProcessEnv | (() => NodeJS.ProcessEnv);
  readonly timeoutMs?: number;
}

function readSocketIdentity(path: string): HyprnavSocketIdentity | null {
  let stat: NodeFS.Stats;
  try {
    stat = NodeFS.lstatSync(path);
  } catch (error) {
    if (isUnavailable(error)) return null;
    throw error;
  }
  if (!stat.isSocket()) throw new Error(`Refusing to replace non-socket Corkdiff path: ${path}`);
  return { device: stat.dev, inode: stat.ino };
}

function sameSocketIdentity(left: HyprnavSocketIdentity, right: HyprnavSocketIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatArg(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/u.test(value) ? value : quoteShellArg(value);
}

function normalizeSlot(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeScope(value: unknown): ProjectHyprnavScope | null {
  return value === "project" || value === "worktree" || value === "thread" ? value : null;
}

export function normalizeClearBindings(
  bindings: readonly DesktopHyprnavScopedSlot[] | undefined,
): DesktopHyprnavScopedSlot[] {
  const unique = new Map<string, DesktopHyprnavScopedSlot>();
  for (const binding of bindings ?? []) {
    const slot = normalizeSlot(binding.slot);
    const scope = normalizeScope(binding.scope);
    if (slot !== null && scope !== null) unique.set(`${scope}:${String(slot)}`, { scope, slot });
  }
  return [...unique.values()].toSorted((left, right) =>
    left.scope === right.scope ? left.slot - right.slot : left.scope.localeCompare(right.scope),
  );
}

function hashSegment(value: string): string {
  return NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function buildHyprnavEnvironmentIds(input: {
  readonly projectRoot: string;
  readonly worktreePath: string | null;
  readonly threadId: string | null;
}): EnvironmentIds {
  const targetPath = input.worktreePath ?? input.projectRoot;
  const projectEnvId = `p.${hashSegment(input.projectRoot)}`;
  const worktreeEnvId = `${projectEnvId}.w.${hashSegment(targetPath)}`;
  const threadEnvId = input.threadId ? `${worktreeEnvId}.t.${input.threadId}` : null;
  return {
    projectEnvId,
    worktreeEnvId,
    threadEnvId,
    lockEnvId: threadEnvId ?? worktreeEnvId,
    targetPath,
  };
}

export function buildWorktreeTerminalCommand(
  environmentPath: string,
  terminalCommand = "exec tmux",
): string {
  return [
    "exec ghostty",
    "--gtk-single-instance=false",
    `--working-directory=${quoteShellArg(environmentPath)}`,
    "-e sh -lc",
    quoteShellArg(terminalCommand),
  ].join(" ");
}

export function buildEditorCommand(
  environmentPath: string,
  preferredEditor: EditorId | null | undefined,
  commandAvailable: (command: string) => boolean = isCommandAvailable,
): string | null {
  if (!preferredEditor) return null;
  const editor = EDITORS.find((candidate) => candidate.id === preferredEditor);
  if (!editor) return null;
  const commands = editor.commands ?? ["xdg-open"];
  const command = commands.find(commandAvailable);
  if (!command) return null;
  const baseArgs = "baseArgs" in editor ? editor.baseArgs : [];
  return [command, ...baseArgs, environmentPath].map(quoteShellArg).join(" ");
}

function isCommandAvailable(command: string): boolean {
  const pathValue = process.env.PATH ?? "";
  for (const directory of pathValue.split(NodePath.delimiter)) {
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

function buildCorkdiffCommand(input: {
  readonly cwd: string;
  readonly connection: DesktopHyprnavCorkdiffConnectionInput;
  readonly threadId: string;
  readonly runtimeEnv: NodeJS.ProcessEnv;
}): string {
  const className = createCorkdiffGhosttyClassName(input.threadId);
  const nvimServerAddress = createCorkdiffNvimServerAddress(input.threadId, input.runtimeEnv);
  const env = [
    `T3CODE_SERVER_URL=${quoteShellArg(input.connection.serverUrl)}`,
    `T3CODE_THREAD_ID=${quoteShellArg(input.threadId)}`,
    `T3CODE_TOKEN=${quoteShellArg(input.connection.token ?? "")}`,
  ];
  return [
    "cd",
    quoteShellArg(input.cwd),
    "&&",
    ...env,
    "exec ghostty",
    ...buildCorkdiffGhosttyArgs({
      className,
      nvimServerAddress,
      threadId: input.threadId,
    }).map(quoteShellArg),
  ].join(" ");
}

interface TemplateContext {
  readonly projectRoot: string;
  readonly targetPath: string;
  readonly threadId: string | null;
  readonly corkdiffConnection: DesktopHyprnavCorkdiffConnectionInput | null;
  readonly runtimeEnv?: NodeJS.ProcessEnv;
}

export function expandHyprnavCommandTemplate(
  template: string,
  context: TemplateContext,
):
  | { readonly ok: true; readonly command: string }
  | { readonly ok: false; readonly message: string } {
  let failure: string | null = null;
  const command = template.replaceAll(
    /(?<!\$)\{([A-Za-z][A-Za-z0-9]*)\}/gu,
    (_match, name: string) => {
      const replacements: Record<string, string | null> = {
        projectRoot: quoteShellArg(context.projectRoot),
        worktreePath: quoteShellArg(context.targetPath),
        threadId: context.threadId ? quoteShellArg(context.threadId) : null,
        corkdiffServerUrl: context.corkdiffConnection
          ? quoteShellArg(context.corkdiffConnection.serverUrl)
          : null,
        corkdiffToken: context.corkdiffConnection
          ? quoteShellArg(context.corkdiffConnection.token ?? "")
          : null,
        corkdiffLaunchCommand:
          context.corkdiffConnection && context.threadId
            ? buildCorkdiffCommand({
                cwd: context.targetPath,
                connection: context.corkdiffConnection,
                threadId: context.threadId,
                runtimeEnv: context.runtimeEnv ?? process.env,
              })
            : null,
      };
      if (!(name in replacements)) {
        failure = `Hyprnav command uses an unknown placeholder: {${name}}.`;
        return "";
      }
      const replacement = replacements[name];
      if (replacement === null || replacement === undefined) {
        failure = `Hyprnav command requires {${name}} for this scope.`;
        return "";
      }
      return replacement;
    },
  );
  return failure === null ? { ok: true, command } : { ok: false, message: failure };
}

function resolveScopeEnvId(scope: ProjectHyprnavScope, ids: EnvironmentIds): string | null {
  switch (scope) {
    case "project":
      return ids.projectEnvId;
    case "worktree":
      return ids.worktreeEnvId;
    case "thread":
      return ids.threadEnvId;
  }
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export class HyprnavEnvironmentManager {
  private readonly spawn: typeof NodeChildProcess.spawn;
  private readonly resolvePath: (...segments: string[]) => string;
  private readonly realpathSync: (path: string) => string;
  private readonly commandAvailable: (command: string) => boolean;
  private readonly readSocketIdentity: (path: string) => HyprnavSocketIdentity | null;
  private readonly unlinkSocket: (path: string) => void;
  private readonly runtimeEnv: () => NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(options: HyprnavEnvironmentManagerOptions = {}) {
    this.spawn = options.spawn ?? NodeChildProcess.spawn;
    this.resolvePath = options.resolvePath ?? NodePath.resolve;
    this.realpathSync = options.realpathSync ?? ((path) => NodeFS.realpathSync.native(path));
    this.commandAvailable = options.commandAvailable ?? isCommandAvailable;
    this.readSocketIdentity = options.readSocketIdentity ?? readSocketIdentity;
    this.unlinkSocket = options.unlinkSocket ?? NodeFS.unlinkSync;
    const runtimeEnv = options.runtimeEnv;
    this.runtimeEnv =
      typeof runtimeEnv === "function"
        ? runtimeEnv
        : runtimeEnv === undefined
          ? () => process.env
          : () => runtimeEnv;
    this.timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  }

  sync(input: DesktopHyprnavSyncInput): Promise<DesktopHyprnavSyncResult> {
    let canonical: CanonicalSyncInput;
    try {
      canonical = this.canonicalize(input);
    } catch (error) {
      return Promise.resolve({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return this.serialize(() => this.performSync(canonical));
  }

  lock(input: DesktopHyprnavLockInput): Promise<DesktopHyprnavSyncResult> {
    const envId = input.envId.trim();
    if (envId.length === 0) {
      return Promise.resolve({
        status: "error",
        message: "Missing environment id.",
      });
    }
    return this.serialize(() => this.run(["lock", envId]));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const key = "global";
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.chains.set(key, current);
    const cleanup = () => {
      if (this.chains.get(key) === current) this.chains.delete(key);
    };
    void current.then(cleanup, cleanup);
    return current;
  }

  private canonicalize(input: DesktopHyprnavSyncInput): CanonicalSyncInput {
    const canonicalPath = (path: string) => this.realpathSync(this.resolvePath(path));
    const projectRoot = canonicalPath(input.projectRoot);
    let worktreePath: string | null = null;
    let staleWorktree = false;
    if (input.worktreePath) {
      try {
        worktreePath = canonicalPath(input.worktreePath);
      } catch (error) {
        // Thread projections can briefly retain a worktree after it has been removed.
        // Keep project-scoped publication, but discard operations for the stale target.
        if (isUnavailable(error)) staleWorktree = true;
        else throw error;
      }
    }
    const retainScope = (item: { readonly scope: ProjectHyprnavScope }) =>
      !staleWorktree || item.scope === "project";
    return {
      ...input,
      projectRoot,
      worktreePath,
      threadId: staleWorktree ? null : input.threadId?.trim() || null,
      threadTitle: staleWorktree ? null : input.threadTitle?.trim() || null,
      hyprnav: { bindings: input.hyprnav.bindings.filter(retainScope) },
      clearBindings: normalizeClearBindings(input.clearBindings).filter(retainScope),
      clearNames: normalizeClearBindings(input.clearNames).filter(retainScope),
      corkdiffConnection:
        !staleWorktree && input.corkdiffConnection?.serverUrl.trim()
          ? {
              serverUrl: input.corkdiffConnection.serverUrl.trim(),
              token: input.corkdiffConnection.token,
            }
          : null,
      lock: staleWorktree ? false : input.lock,
    };
  }

  private resolveBinding(
    input: CanonicalSyncInput,
    ids: EnvironmentIds,
    binding: ProjectHyprnavBinding,
  ): ResolvedBinding | DesktopHyprnavSyncResult | null {
    const slot = normalizeSlot(binding.slot);
    const envId = resolveScopeEnvId(binding.scope, ids);
    if (slot === null || envId === null) return null;
    const environmentPath = binding.scope === "project" ? input.projectRoot : ids.targetPath;
    let command: string | null;
    switch (binding.action) {
      case "worktree-terminal":
        command = buildWorktreeTerminalCommand(
          environmentPath,
          resolveTerminalExecCommand(this.runtimeEnv(), this.commandAvailable),
        );
        break;
      case "open-favorite-editor":
        command = buildEditorCommand(environmentPath, input.preferredEditor, this.commandAvailable);
        if (command === null) {
          return {
            status: "unavailable",
            message: "No available favorite editor is configured.",
          };
        }
        break;
      case "nothing":
        command = ":";
        break;
      case "shell-command": {
        const expansion = expandHyprnavCommandTemplate(binding.command, {
          projectRoot: input.projectRoot,
          targetPath: ids.targetPath,
          threadId: input.threadId,
          corkdiffConnection: input.corkdiffConnection,
          runtimeEnv: this.runtimeEnv(),
        });
        if (!expansion.ok) return { status: "error", message: expansion.message };
        command = expansion.command;
        break;
      }
    }
    return {
      envId,
      slot,
      name: binding.name ?? null,
      workspaceId: binding.workspace.mode === "absolute" ? binding.workspace.workspaceId : null,
      command,
    };
  }

  private async performSync(input: CanonicalSyncInput): Promise<DesktopHyprnavSyncResult> {
    const ids = buildHyprnavEnvironmentIds(input);
    const resolved: ResolvedBinding[] = [];
    let bindingError: DesktopHyprnavSyncResult | null = null;
    for (const binding of input.hyprnav.bindings) {
      const result = this.resolveBinding(input, ids, binding);
      if (result && "status" in result) {
        if (!input.lock) return result;
        bindingError = result;
        resolved.length = 0;
        break;
      } else if (result) resolved.push(result);
    }

    if (input.threadId && input.corkdiffConnection) {
      const nvimServerAddress = createCorkdiffNvimServerAddress(input.threadId, this.runtimeEnv());
      let socketIdentity: HyprnavSocketIdentity | null;
      try {
        socketIdentity = this.readSocketIdentity(nvimServerAddress);
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      if (socketIdentity) {
        const probeResult = await this.run(
          ["--server", nvimServerAddress, "--remote-expr", "1"],
          undefined,
          "nvim",
        );
        if (probeResult.status === "unavailable") return probeResult;
        if (probeResult.status === "error") {
          try {
            const currentIdentity = this.readSocketIdentity(nvimServerAddress);
            if (currentIdentity === null) {
              socketIdentity = null;
            } else if (sameSocketIdentity(socketIdentity, currentIdentity)) {
              this.unlinkSocket(nvimServerAddress);
              socketIdentity = null;
            } else {
              return probeResult;
            }
          } catch (error) {
            return {
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            };
          }
        }
      }
      if (socketIdentity) {
        const refreshResult = await this.run(
          [
            "--server",
            nvimServerAddress,
            "--remote-expr",
            buildCorkdiffConnectionUpdateExpression(input.corkdiffConnection),
          ],
          undefined,
          "nvim",
        );
        if (refreshResult.status !== "ok") return refreshResult;
      }
    }

    const scopes = new Set<ProjectHyprnavScope>([
      ...input.hyprnav.bindings.map((binding) => binding.scope),
      ...input.clearBindings.map((binding) => binding.scope),
      ...input.clearNames.map((binding) => binding.scope),
    ]);
    if (input.lock && input.threadId) scopes.add("thread");

    const operations: BatchOperation[] = [];
    for (const [scope, env, cwd] of [
      ["project", ids.projectEnvId, input.projectRoot],
      ["worktree", ids.worktreeEnvId, ids.targetPath],
      ["thread", ids.threadEnvId, ids.targetPath],
    ] as const) {
      if (!scopes.has(scope) || env === null) continue;
      operations.push({
        op: "env_ensure",
        env,
        cwd,
        client: CLIENT_ID,
        ...(scope === "thread" && input.threadTitle ? { title: input.threadTitle } : {}),
      });
    }

    const cleared = new Set(
      input.clearBindings.map((item) => `${item.scope}:${String(item.slot)}`),
    );
    for (const item of input.clearBindings) {
      const env = resolveScopeEnvId(item.scope, ids);
      if (!env) continue;
      operations.push({ op: "slot_command_clear", env, slot: item.slot });
      operations.push({
        op: "slot_clear",
        env,
        slot: item.slot,
        client: CLIENT_ID,
      });
    }
    for (const binding of resolved) {
      operations.push({
        op: "slot_assign",
        env: binding.envId,
        slot: binding.slot,
        assignment_mode:
          binding.workspaceId === null
            ? { mode: "managed" }
            : { mode: "fixed", workspace_id: binding.workspaceId },
        client: CLIENT_ID,
        ...(binding.name ? { display_name: binding.name } : {}),
      });
      operations.push(
        binding.command === null
          ? { op: "slot_command_clear", env: binding.envId, slot: binding.slot }
          : {
              op: "slot_command_set",
              env: binding.envId,
              slot: binding.slot,
              argv: ["sh", "-lc", binding.command],
              ...(binding.name ? { display_name: binding.name } : {}),
            },
      );
    }
    for (const item of input.clearNames) {
      if (cleared.has(`${item.scope}:${String(item.slot)}`)) continue;
      const env = resolveScopeEnvId(item.scope, ids);
      if (env) operations.push({ op: "slot_name_clear", env, slot: item.slot });
    }

    const syncResult = operations.length
      ? await this.run(["batch", "--stdin"], JSON.stringify({ atomic: true, operations }))
      : { status: "ok" as const, message: null };
    if (syncResult.status !== "ok") return bindingError ?? syncResult;
    const appliedScopes = [...scopes];
    if (!input.lock) return bindingError ?? { ...syncResult, appliedScopes };
    const lockResult = await this.run(["lock", ids.lockEnvId]);
    return (
      bindingError ?? (lockResult.status === "ok" ? { ...lockResult, appliedScopes } : lockResult)
    );
  }

  private async run(
    args: readonly string[],
    stdin?: string,
    command = "hyprnav",
  ): Promise<DesktopHyprnavSyncResult> {
    try {
      const result = await new Promise<{
        code: number | null;
        stderr: string;
        timedOut: boolean;
      }>((resolve, reject) => {
        const child = this.spawn(command, [...args], {
          stdio: [stdin === undefined ? "ignore" : "pipe", "ignore", "pipe"],
        });
        let stderr = "";
        let timedOut = false;
        let settled = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, this.timeoutMs);
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback();
        };
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => (stderr += chunk));
        child.once("error", (error) => finish(() => reject(error)));
        child.stdin?.once("error", (error) => finish(() => reject(error)));
        child.once("exit", (code) => finish(() => resolve({ code, stderr, timedOut })));
        if (stdin !== undefined) child.stdin?.end(stdin, "utf8");
      });
      const rendered = [command, ...args].map(formatArg).join(" ");
      if (result.timedOut) return { status: "error", message: `${rendered} timed out.` };
      if (result.code === 0) return { status: "ok", message: null };
      return {
        status: "error",
        message: result.stderr.trim() || `${rendered} exited with code ${String(result.code)}.`,
      };
    } catch (error) {
      if (isUnavailable(error)) {
        return {
          status: "unavailable",
          message: `${command} is not installed or not available in PATH.`,
        };
      }
      return {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class HyprnavEnvironment extends Context.Service<
  HyprnavEnvironment,
  {
    readonly sync: (input: DesktopHyprnavSyncInput) => Effect.Effect<DesktopHyprnavSyncResult>;
    readonly lock: (input: DesktopHyprnavLockInput) => Effect.Effect<DesktopHyprnavSyncResult>;
  }
>()("@t3tools/desktop/hyprnav/HyprnavEnvironment") {}

const make = Effect.sync(() => {
  const manager = new HyprnavEnvironmentManager();
  return HyprnavEnvironment.of({
    sync: (input) => Effect.promise(() => manager.sync(input)),
    lock: (input) => Effect.promise(() => manager.lock(input)),
  });
});

export const layer = Layer.effect(HyprnavEnvironment, make);
