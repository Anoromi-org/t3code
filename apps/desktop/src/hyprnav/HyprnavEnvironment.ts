// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type {
  DesktopHyprnavBrowserTab,
  DesktopHyprnavBrowserTabRegistration,
  DesktopHyprnavBrowserTabsSyncInput,
  DesktopHyprnavBrowserTabsSyncResult,
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
/** `tab open` may wait on the browser opening a tab. */
const TAB_OPEN_TIMEOUT_MS = 15_000;
const BROWSER_TAB_CONCURRENCY = 8;
const BROWSER_TABS_BATCH_THREADS = 100;
/** Tags T3's lock moves so its own follower can ignore the daemon's `locked` echo. */
const ORIGIN_ARGS = ["--origin", CLIENT_ID] as const;

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
  readonly projectTitle: string | null;
  readonly worktreeTitle: string | null;
  readonly clearBindings: readonly DesktopHyprnavScopedSlot[];
  readonly clearNames: readonly DesktopHyprnavScopedSlot[];
  readonly corkdiffConnection: DesktopHyprnavCorkdiffConnectionInput | null;
  readonly browserTabs: readonly DesktopHyprnavBrowserTab[];
  readonly clearBrowserTabs: readonly number[];
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

export interface HyprnavBrowserTabPlan {
  /** Batch operations: a fixed local slot per tab, `slot_clear` for dropped slots. */
  readonly operations: BatchOperation[];
  /** Tabs to attach with `tab assign` (before skipping already-applied ones). */
  readonly assign: DesktopHyprnavBrowserTab[];
  /** Dropped slots a project binding still owns: only their browser target goes. */
  readonly tabClears: number[];
  /** Dropped slots removed outright; hyprnav deletes their browser target with them. */
  readonly slotClears: number[];
}

function normalizeBrowserTab(tab: DesktopHyprnavBrowserTab): DesktopHyprnavBrowserTab | null {
  const slot = normalizeSlot(tab.slot);
  const workspaceId = normalizeSlot(tab.workspaceId);
  const tabName = tab.tabName.trim();
  const value = tab.value.trim();
  if (slot === null || workspaceId === null || !tabName || !value) return null;
  if (tab.browser !== "chromium" && tab.browser !== "firefox") return null;
  return { slot, workspaceId, browser: tab.browser, tabName, value };
}

/**
 * Plans one thread environment's browser slots. A thread-scope project binding
 * on the same slot wins: hyprnav would otherwise navigate the browser instead
 * of running the binding's command.
 */
export function planHyprnavBrowserTabs(input: {
  readonly envId: string;
  readonly tabs: readonly DesktopHyprnavBrowserTab[];
  readonly clearSlots: readonly number[];
  readonly bindingSlots: ReadonlySet<number>;
}): HyprnavBrowserTabPlan {
  const assign: DesktopHyprnavBrowserTab[] = [];
  const operations: BatchOperation[] = [];
  for (const raw of input.tabs) {
    const tab = normalizeBrowserTab(raw);
    if (!tab || input.bindingSlots.has(tab.slot)) continue;
    if (assign.some((existing) => existing.slot === tab.slot)) continue;
    assign.push(tab);
    operations.push({
      op: "slot_assign",
      env: input.envId,
      slot: tab.slot,
      assignment_mode: { mode: "fixed", workspace_id: tab.workspaceId },
      client: CLIENT_ID,
      display_name: tab.tabName,
    });
  }
  const tabClears: number[] = [];
  const slotClears: number[] = [];
  for (const raw of new Set(input.clearSlots)) {
    const slot = normalizeSlot(raw);
    if (slot === null || assign.some((tab) => tab.slot === slot)) continue;
    if (input.bindingSlots.has(slot)) {
      tabClears.push(slot);
      continue;
    }
    slotClears.push(slot);
    operations.push({ op: "slot_clear", env: input.envId, slot, client: CLIENT_ID });
  }
  return { operations, assign, tabClears, slotClears };
}

function browserTargetKey(envId: string, slot: number): string {
  return `${envId}\0${String(slot)}`;
}

function browserTargetSignature(tab: DesktopHyprnavBrowserTab): string {
  return JSON.stringify([tab.browser, tab.tabName, tab.value]);
}

export function buildHyprnavTabAssignArgs(envId: string, tab: DesktopHyprnavBrowserTab): string[] {
  return [
    ...ORIGIN_ARGS,
    "tab",
    "assign",
    "--browser",
    tab.browser,
    "--env",
    envId,
    "--slot",
    String(tab.slot),
    "--name",
    tab.tabName,
    "--workspace",
    tab.value,
  ];
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

/** Runs tasks with bounded parallelism; results keep the tasks' order. */
async function runConcurrently<T>(tasks: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
  const results: T[] = Array.from({ length: tasks.length });
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]!();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BROWSER_TAB_CONCURRENCY, tasks.length) }, worker),
  );
  return results;
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
  /**
   * Browser targets this process attached, by env and slot. `tab assign` has no
   * batch op, so this keeps a sync from spawning one per thread when nothing
   * changed. Starts empty each launch, so targets are re-attached once.
   */
  private readonly browserTargets = new Map<string, string>();

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
    return this.serialize(() => this.run([...ORIGIN_ARGS, "lock", envId]));
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
      projectTitle: input.projectTitle?.trim() || null,
      worktreeTitle: staleWorktree ? null : input.worktreeTitle?.trim() || null,
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
      browserTabs: staleWorktree ? [] : (input.browserTabs ?? []),
      clearBrowserTabs: staleWorktree ? [] : (input.clearBrowserTabs ?? []),
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
    const browserPlan =
      ids.threadEnvId && (input.browserTabs.length > 0 || input.clearBrowserTabs.length > 0)
        ? planHyprnavBrowserTabs({
            envId: ids.threadEnvId,
            tabs: input.browserTabs,
            clearSlots: input.clearBrowserTabs,
            bindingSlots: new Set(
              resolved
                .filter((binding) => binding.envId === ids.threadEnvId)
                .map((binding) => binding.slot),
            ),
          })
        : null;
    if (browserPlan) scopes.add("thread");

    // Ensure every touched environment together with its ancestors, so the
    // hyprnav breadcrumb for a thread row can show project and worktree titles
    // even when only thread-scoped slots are published.
    const operations: BatchOperation[] = [];
    const chain = [
      ["project", ids.projectEnvId, input.projectRoot, input.projectTitle],
      ["worktree", ids.worktreeEnvId, ids.targetPath, input.worktreeTitle],
      ["thread", ids.threadEnvId, ids.targetPath, input.threadTitle],
    ] as const;
    chain.forEach(([, env, cwd, title], index) => {
      if (env === null || !chain.slice(index).some(([scope]) => scopes.has(scope))) return;
      operations.push({
        op: "env_ensure",
        env,
        cwd,
        client: CLIENT_ID,
        ...(title ? { title } : {}),
      });
    });

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
    if (browserPlan && ids.threadEnvId) {
      operations.push(...browserPlan.operations);
      // A cleared slot loses its browser target in hyprnav; forget it here too.
      for (const item of input.clearBindings) {
        if (item.scope === "thread") {
          this.browserTargets.delete(browserTargetKey(ids.threadEnvId, item.slot));
        }
      }
      for (const slot of browserPlan.slotClears) {
        this.browserTargets.delete(browserTargetKey(ids.threadEnvId, slot));
      }
    }

    const syncResult = operations.length
      ? await this.run(
          [...ORIGIN_ARGS, "batch", "--stdin"],
          JSON.stringify({ atomic: true, operations }),
        )
      : { status: "ok" as const, message: null };
    if (syncResult.status !== "ok") return bindingError ?? syncResult;
    const appliedScopes = [...scopes];
    let lockResult: DesktopHyprnavSyncResult = syncResult;
    if (input.lock) lockResult = await this.run([...ORIGIN_ARGS, "lock", ids.lockEnvId]);
    // After the lock so attaching tabs never delays navigation. A failure here
    // is reported on an ok result: retrying the whole sync would re-lock.
    const browserFailure =
      browserPlan && ids.threadEnvId
        ? await this.applyBrowserPlan(ids.threadEnvId, browserPlan)
        : null;
    if (bindingError) return bindingError;
    if (lockResult.status !== "ok") return lockResult;
    return { status: "ok", message: browserFailure, appliedScopes };
  }

  /** Runs the non-batch half of a browser plan; returns the first failure message. */
  private async applyBrowserPlan(
    envId: string,
    plan: HyprnavBrowserTabPlan,
  ): Promise<string | null> {
    const messages = await runConcurrently(this.browserPlanTasks(envId, plan));
    return messages.find((message) => message !== null) ?? null;
  }

  /** `tab clear` / `tab assign` calls a plan still needs; unchanged targets are skipped. */
  private browserPlanTasks(
    envId: string,
    plan: HyprnavBrowserTabPlan,
  ): Array<() => Promise<string | null>> {
    const tasks: Array<() => Promise<string | null>> = [];
    for (const slot of plan.tabClears) {
      tasks.push(async () => {
        const args = [...ORIGIN_ARGS, "tab", "clear", "--env", envId, "--slot", String(slot)];
        const result = await this.run(args);
        if (result.status !== "ok") return result.message ?? "hyprnav tab clear failed.";
        this.browserTargets.delete(browserTargetKey(envId, slot));
        return null;
      });
    }
    for (const tab of plan.assign) {
      const key = browserTargetKey(envId, tab.slot);
      const signature = browserTargetSignature(tab);
      if (this.browserTargets.get(key) === signature) continue;
      tasks.push(async () => {
        const result = await this.run(buildHyprnavTabAssignArgs(envId, tab));
        if (result.status !== "ok") {
          this.browserTargets.delete(key);
          return result.message ?? "hyprnav tab assign failed.";
        }
        this.browserTargets.set(key, signature);
        return null;
      });
    }
    return tasks;
  }

  /**
   * Applies browser slots to many threads at once: one `batch` per chunk of
   * threads, then `tab assign` only where the attached target changed.
   */
  syncBrowserTabs(
    input: DesktopHyprnavBrowserTabsSyncInput,
  ): Promise<DesktopHyprnavBrowserTabsSyncResult> {
    return this.serialize(() => this.performBrowserTabsSync(input));
  }

  private async performBrowserTabsSync(
    input: DesktopHyprnavBrowserTabsSyncInput,
  ): Promise<DesktopHyprnavBrowserTabsSyncResult> {
    const canonicalPath = (path: string) => this.realpathSync(this.resolvePath(path));
    const planned: Array<{
      readonly threadId: string;
      readonly envId: string;
      readonly plan: HyprnavBrowserTabPlan;
      readonly ensures: BatchOperation[];
    }> = [];
    const appliedThreadIds: string[] = [];
    let failure: string | null = null;
    let unavailable = false;
    for (const thread of input.threads) {
      const threadId = thread.threadId.trim();
      if (!threadId) continue;
      let projectRoot: string;
      let worktreePath: string | null;
      try {
        projectRoot = canonicalPath(thread.projectRoot);
        worktreePath = thread.worktreePath ? canonicalPath(thread.worktreePath) : null;
      } catch (error) {
        // A removed worktree has no environment worth a browser slot.
        if (isUnavailable(error)) continue;
        failure ??= error instanceof Error ? error.message : String(error);
        continue;
      }
      const ids = buildHyprnavEnvironmentIds({ projectRoot, worktreePath, threadId });
      const envId = ids.threadEnvId!;
      const plan = planHyprnavBrowserTabs({
        envId,
        tabs: thread.browserTabs,
        clearSlots: thread.clearBrowserTabs,
        bindingSlots: new Set(thread.bindingSlots),
      });
      if (plan.operations.length === 0 && plan.tabClears.length === 0) {
        appliedThreadIds.push(threadId);
        continue;
      }
      for (const slot of plan.slotClears) this.browserTargets.delete(browserTargetKey(envId, slot));
      const ensures = [
        [ids.projectEnvId, projectRoot, thread.projectTitle],
        [ids.worktreeEnvId, ids.targetPath, thread.worktreeTitle],
        [envId, ids.targetPath, thread.threadTitle],
      ].map(([env, cwd, title]) => ({
        op: "env_ensure",
        env,
        cwd,
        client: CLIENT_ID,
        ...(title?.trim() ? { title: title.trim() } : {}),
      }));
      planned.push({ threadId, envId, plan, ensures });
    }

    for (let index = 0; index < planned.length; index += BROWSER_TABS_BATCH_THREADS) {
      const chunk = planned.slice(index, index + BROWSER_TABS_BATCH_THREADS);
      const ensured = new Map<string, BatchOperation>();
      for (const item of chunk) {
        for (const ensure of item.ensures) ensured.set(String(ensure.env), ensure);
      }
      const operations = [...ensured.values(), ...chunk.flatMap((item) => item.plan.operations)];
      const batchResult = await this.run(
        [...ORIGIN_ARGS, "batch", "--stdin"],
        JSON.stringify({ atomic: true, operations }),
      );
      if (batchResult.status !== "ok") {
        failure ??= batchResult.message;
        if (batchResult.status === "unavailable") {
          unavailable = true;
          break;
        }
        continue;
      }
      const messages = await runConcurrently(
        chunk.map((item) => async () => {
          for (const task of this.browserPlanTasks(item.envId, item.plan)) {
            const message = await task();
            if (message !== null) return message;
          }
          return null;
        }),
      );
      chunk.forEach((item, chunkIndex) => {
        const message = messages[chunkIndex] ?? null;
        if (message === null) appliedThreadIds.push(item.threadId);
        else failure ??= message;
      });
    }
    return failure === null
      ? { status: "ok", message: null, appliedThreadIds }
      : { status: unavailable ? "unavailable" : "error", message: failure, appliedThreadIds };
  }

  /** `hyprnav tab open`: adopt a matching open tab under the name, or open one. */
  registerBrowserTab(
    input: DesktopHyprnavBrowserTabRegistration,
  ): Promise<DesktopHyprnavSyncResult> {
    const tabName = input.tabName.trim();
    const url = input.url.trim();
    const param = input.param.trim();
    if (!tabName || !url || !param) {
      return Promise.resolve({
        status: "error",
        message: "Tab name, URL and parameter are required.",
      });
    }
    return this.run(
      [
        ...ORIGIN_ARGS,
        "tab",
        "open",
        "--browser",
        input.browser,
        "--name",
        tabName,
        "--url",
        url,
        "--param",
        param,
      ],
      undefined,
      "hyprnav",
      TAB_OPEN_TIMEOUT_MS,
    );
  }

  private async run(
    args: readonly string[],
    stdin?: string,
    command = "hyprnav",
    timeoutMs = this.timeoutMs,
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
        }, timeoutMs);
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
    readonly syncBrowserTabs: (
      input: DesktopHyprnavBrowserTabsSyncInput,
    ) => Effect.Effect<DesktopHyprnavBrowserTabsSyncResult>;
    readonly registerBrowserTab: (
      input: DesktopHyprnavBrowserTabRegistration,
    ) => Effect.Effect<DesktopHyprnavSyncResult>;
  }
>()("@t3tools/desktop/hyprnav/HyprnavEnvironment") {}

const make = Effect.sync(() => {
  const manager = new HyprnavEnvironmentManager();
  return HyprnavEnvironment.of({
    sync: (input) => Effect.promise(() => manager.sync(input)),
    lock: (input) => Effect.promise(() => manager.lock(input)),
    syncBrowserTabs: (input) => Effect.promise(() => manager.syncBrowserTabs(input)),
    registerBrowserTab: (input) => Effect.promise(() => manager.registerBrowserTab(input)),
  });
});

export const layer = Layer.effect(HyprnavEnvironment, make);
