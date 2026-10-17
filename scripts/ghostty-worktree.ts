#!/usr/bin/env node
// @effect-diagnostics globalDate:off globalTimers:off nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  hyprctlCommandError,
  hyprlandExecDispatcher,
  hyprlandFocusWindowDispatcher,
  hyprlandFocusWorkspaceDispatcher,
} from "@t3tools/shared/hyprland";

import {
  createAssignmentKey,
  normalizePath,
  resolveGitCommonDirForWorktree,
  resolveWorktreeFromCwd,
  type ResolvedWorktree,
} from "./lib/worktree.ts";

const CLASS_PREFIX = "dev.t3tools.t3code.ghostty";
const POLL_ATTEMPTS = 30;
const LOCK_RETRY_MS = 50;
const LOCK_WAIT_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 5_000;
const LEGACY_LIVE_LOCK_MAX_MS = 30_000;
const { execFileSync, spawnSync } = NodeChildProcess;
const { createHash, randomUUID } = NodeCrypto;
const NodeFs = NodeFS;
const { homedir } = NodeOS;

async function acquireKernelRecoveryLock(
  statePath: string,
  waitTimeoutMs: number,
): Promise<(() => Promise<void>) | null> {
  const startedAt = Date.now();
  const mutexName = `\0${createRecoveryMutexKey(statePath)}`;
  for (;;) {
    const server = NodeNet.createServer((socket) => socket.destroy());
    const acquired = await new Promise<boolean>((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else reject(error);
      });
      server.listen({ path: mutexName }, () => resolve(true));
    });
    if (acquired) {
      let released: Promise<void> | null = null;
      return () => {
        released ??= new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        return released;
      };
    }
    const remainingMs = waitTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) return null;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(LOCK_RETRY_MS, remainingMs));
    });
  }
}

export function createRecoveryMutexKey(statePath: string): string {
  return `t3code-ghostty-worktree-${createHash("sha256")
    .update(NodePath.resolve(statePath))
    .digest("hex")
    .slice(0, 32)}`;
}

export interface GhosttyAssignment {
  readonly repoCommonDir: string;
  readonly worktreeRoot: string;
  readonly pid: number;
  readonly className: string;
  readonly title: string;
}

export interface Registry {
  readonly version: 1;
  readonly assignments: Record<string, GhosttyAssignment>;
}

export interface HyprClient {
  readonly address: string;
  readonly workspace: number;
  readonly pid: number;
  readonly className: string;
}

export function findManagedClientByClassName(
  values: readonly HyprClient[],
  className: string,
): HyprClient | null {
  return values.find((client) => client.className === className) ?? null;
}

export function resolveStateFilePath(env: NodeJS.ProcessEnv, home = homedir()): string {
  return NodePath.join(
    env.XDG_STATE_HOME?.trim() || NodePath.join(home, ".local", "state"),
    "ghostty-worktree",
    "assignments.json",
  );
}

export function createManagedClassName(worktreeKey: string): string {
  return `${CLASS_PREFIX}.w${createHash("sha256").update(worktreeKey).digest("hex").slice(0, 12)}`;
}

export function createManagedTitle(worktree: ResolvedWorktree): string {
  const repo = NodePath.basename(NodePath.dirname(worktree.repoCommonDir));
  const worktreeName = NodePath.basename(worktree.worktreeRoot);
  return repo === worktreeName ? `Ghostty ${repo}` : `Ghostty ${repo}:${worktreeName}`;
}

export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildGhosttyLaunchCommand(input: {
  readonly className: string;
  readonly cwd: string;
  readonly title: string;
  readonly execCommand: string | null;
}): string {
  const launcher = input.execCommand
    ? 'exec ghostty --gtk-single-instance=false --class="$1" --title="$2" --working-directory="$3" -e sh -lc "$4"'
    : 'exec ghostty --gtk-single-instance=false --class="$1" --title="$2" --working-directory="$3"';
  return [
    "sh -lc",
    quoteShellArg(launcher),
    "ghostty-worktree",
    quoteShellArg(input.className),
    quoteShellArg(input.title),
    quoteShellArg(input.cwd),
    ...(input.execCommand ? [quoteShellArg(input.execCommand)] : []),
  ].join(" ");
}

export function parseCliArgs(argv: readonly string[]): {
  readonly mode: "open" | "list-open";
  readonly execCommand: string | null;
} {
  if (argv.length === 0) return { mode: "open", execCommand: null };
  if (argv.length === 1 && argv[0] === "list-open") return { mode: "list-open", execCommand: null };
  if (argv.length === 2 && argv[0] === "--exec" && argv[1]?.trim()) {
    return { mode: "open", execCommand: argv[1].trim() };
  }
  throw new Error("ghostty-worktree only accepts no args, 'list-open', or '--exec <command>'.");
}

function emptyRegistry(): Registry {
  return { version: 1, assignments: {} };
}

function isRegistry(value: unknown): value is Registry {
  if (
    !(
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      value.version === 1 &&
      "assignments" in value &&
      typeof value.assignments === "object" &&
      value.assignments !== null &&
      !Array.isArray(value.assignments)
    )
  ) {
    return false;
  }
  return Object.entries(value.assignments).every(
    ([key, assignment]) =>
      key.length > 0 &&
      typeof assignment === "object" &&
      assignment !== null &&
      "repoCommonDir" in assignment &&
      typeof assignment.repoCommonDir === "string" &&
      assignment.repoCommonDir.length > 0 &&
      "worktreeRoot" in assignment &&
      typeof assignment.worktreeRoot === "string" &&
      assignment.worktreeRoot.length > 0 &&
      "pid" in assignment &&
      Number.isSafeInteger(assignment.pid) &&
      assignment.pid > 0 &&
      "className" in assignment &&
      typeof assignment.className === "string" &&
      assignment.className.length > 0 &&
      "title" in assignment &&
      typeof assignment.title === "string" &&
      assignment.title.length > 0,
  );
}

function quarantineMalformedRegistry(path: string, now: number): Registry {
  const corruptPath = `${path}.corrupt-${String(now)}-${String(process.pid)}`;
  try {
    NodeFs.renameSync(path, corruptPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return emptyRegistry();
}

function unlinkIfExists(path: string): void {
  try {
    NodeFs.unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

interface RecoveryLockOwner {
  readonly token: string;
  readonly pid: number;
  readonly startIdentity: string | null;
}

function parseRecoveryLockOwner(value: string): RecoveryLockOwner | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "token" in parsed &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      "pid" in parsed &&
      typeof parsed.pid === "number" &&
      Number.isSafeInteger(parsed.pid) &&
      parsed.pid > 0 &&
      "startIdentity" in parsed &&
      (typeof parsed.startIdentity === "string" || parsed.startIdentity === null)
    ) {
      return parsed as unknown as RecoveryLockOwner;
    }
  } catch {
    const pid = Number(value.split("-", 1)[0]);
    if (Number.isSafeInteger(pid) && pid > 0) {
      return { token: value, pid, startIdentity: null };
    }
  }
  return null;
}

export function readLinuxProcessStartIdentity(pid: number): string | null {
  try {
    const stat = NodeFs.readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0) return null;
    const fields = stat
      .slice(commandEnd + 1)
      .trim()
      .split(/\s+/u);
    return fields[19]?.trim() || null;
  } catch {
    return null;
  }
}

function removeOwnedLock(ownerPath: string, ownerToken: string, lockPath: string): void {
  try {
    if (parseRecoveryLockOwner(NodeFs.readFileSync(ownerPath, "utf8"))?.token === ownerToken) {
      NodeFs.rmSync(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function readRegistryRecovering(path: string, now = Date.now()): Registry {
  let contents: string;
  try {
    contents = NodeFs.readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyRegistry();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return quarantineMalformedRegistry(path, now);
  }
  if (!isRegistry(parsed)) return quarantineMalformedRegistry(path, now);
  return parsed;
}

export function writeRegistryAtomic(path: string, registry: Registry): void {
  NodeFs.mkdirSync(NodePath.dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${String(process.pid)}-${randomUUID()}`;
  let descriptor: number | null = null;
  try {
    descriptor = NodeFs.openSync(temporaryPath, "wx", 0o600);
    NodeFs.writeFileSync(descriptor, `${JSON.stringify(registry, null, 2)}\n`);
    NodeFs.fsyncSync(descriptor);
    NodeFs.closeSync(descriptor);
    descriptor = null;
    NodeFs.renameSync(temporaryPath, path);
    const directoryDescriptor = NodeFs.openSync(NodePath.dirname(path), "r");
    try {
      NodeFs.fsyncSync(directoryDescriptor);
    } finally {
      NodeFs.closeSync(directoryDescriptor);
    }
  } finally {
    if (descriptor !== null) NodeFs.closeSync(descriptor);
    unlinkIfExists(temporaryPath);
  }
}

export async function withRegistryLock<T>(
  statePath: string,
  operation: () => Promise<T>,
  options: {
    readonly retryMs?: number;
    readonly waitTimeoutMs?: number;
    readonly staleLockMs?: number;
    readonly now?: () => number;
    readonly processStartIdentity?: (pid: number) => string | null;
    readonly beforeStaleClaim?: () => void;
    readonly afterRecoveryLock?: () => Promise<void>;
  } = {},
): Promise<T> {
  const lockPath = `${statePath}.lock`;
  const retryMs = options.retryMs ?? LOCK_RETRY_MS;
  const waitTimeoutMs = options.waitTimeoutMs ?? LOCK_WAIT_TIMEOUT_MS;
  const staleLockMs = options.staleLockMs ?? STALE_LOCK_MS;
  const now = options.now ?? Date.now;
  const processStartIdentity = options.processStartIdentity ?? readLinuxProcessStartIdentity;
  const startedAt = now();
  const ownerToken = `${String(process.pid)}-${randomUUID()}`;
  const ownerRecord: RecoveryLockOwner = {
    token: ownerToken,
    pid: process.pid,
    startIdentity: processStartIdentity(process.pid),
  };
  const ownerPath = NodePath.join(lockPath, "owner");
  const candidatePath = `${lockPath}.candidate-${ownerToken}`;
  NodeFs.mkdirSync(NodePath.dirname(statePath), { recursive: true });
  for (;;) {
    try {
      NodeFs.mkdirSync(candidatePath);
      try {
        NodeFs.writeFileSync(NodePath.join(candidatePath, "owner"), JSON.stringify(ownerRecord), {
          mode: 0o600,
        });
        NodeFs.renameSync(candidatePath, lockPath);
      } catch (error) {
        NodeFs.rmSync(candidatePath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
      try {
        const readOwner = () => {
          try {
            return NodeFs.readFileSync(ownerPath, "utf8");
          } catch (ownerError) {
            if ((ownerError as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw ownerError;
          }
        };
        const ownerStatus = (ownerValue: string | null) => {
          const owner = ownerValue === null ? null : parseRecoveryLockOwner(ownerValue);
          if (!owner) return { alive: false, identityVerified: true };
          if (owner.startIdentity !== null) {
            return {
              alive: processStartIdentity(owner.pid) === owner.startIdentity,
              identityVerified: true,
            };
          }
          try {
            process.kill(owner.pid, 0);
            return { alive: true, identityVerified: false };
          } catch (killError) {
            return {
              alive: (killError as NodeJS.ErrnoException).code === "EPERM",
              identityVerified: false,
            };
          }
        };
        const isRecoverable = (owner: string | null, ageMs: number) => {
          const status = ownerStatus(owner);
          return (
            ageMs >= staleLockMs &&
            (!status.alive || (!status.identityVerified && ageMs >= LEGACY_LIVE_LOCK_MAX_MS))
          );
        };
        const observedOwner = readOwner();
        const observedStat = NodeFs.statSync(lockPath);
        if (isRecoverable(observedOwner, now() - observedStat.mtimeMs)) {
          options.beforeStaleClaim?.();
          let recovered = false;
          const releaseRecoveryLock = await acquireKernelRecoveryLock(
            statePath,
            waitTimeoutMs - (now() - startedAt),
          );
          try {
            if (releaseRecoveryLock) {
              await options.afterRecoveryLock?.();
              const currentOwner = readOwner();
              const currentStat = NodeFs.statSync(lockPath);
              if (
                currentOwner === observedOwner &&
                currentStat.dev === observedStat.dev &&
                currentStat.ino === observedStat.ino &&
                isRecoverable(currentOwner, now() - currentStat.mtimeMs)
              ) {
                NodeFs.rmSync(lockPath, { recursive: true, force: true });
                recovered = true;
              }
            }
          } finally {
            await releaseRecoveryLock?.();
          }
          if (recovered) continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (now() - startedAt >= waitTimeoutMs) {
        throw new Error("Timed out waiting for the ghostty-worktree registry lock.", {
          cause: error,
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, retryMs));
    }
  }
  try {
    return await operation();
  } finally {
    removeOwnedLock(ownerPath, ownerToken, lockPath);
  }
}

function command(commandName: string, args: readonly string[]): string {
  return execFileSync(commandName, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function hyprctl(args: readonly string[]): string {
  const stdout = command("hyprctl", args);
  const commandError = hyprctlCommandError({ code: 0, stdout, stderr: "" });
  if (commandError !== null) throw new Error(commandError);
  return stdout;
}

function clients(): HyprClient[] {
  const parsed: unknown = JSON.parse(hyprctl(["-j", "clients"]));
  if (!Array.isArray(parsed)) throw new Error("hyprctl returned an invalid client list.");
  return parsed.flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const client = value as Record<string, unknown>;
    const workspace = client.workspace as Record<string, unknown> | undefined;
    return typeof client.address === "string" &&
      typeof client.pid === "number" &&
      typeof client.class === "string" &&
      typeof workspace?.id === "number"
      ? [
          {
            address: client.address,
            pid: client.pid,
            className: client.class,
            workspace: workspace.id,
          },
        ]
      : [];
  });
}

function liveClient(
  assignment: GhosttyAssignment,
  values: readonly HyprClient[],
): HyprClient | null {
  return (
    values.find(
      (client) => client.className === assignment.className && client.pid === assignment.pid,
    ) ??
    values.find((client) => client.className === assignment.className) ??
    null
  );
}

function focus(client: HyprClient): void {
  hyprctl(["dispatch", hyprlandFocusWorkspaceDispatcher(client.workspace)]);
  hyprctl(["dispatch", hyprlandFocusWindowDispatcher(client.address)]);
}

export function pruneRegistry(
  registry: Registry,
  options: {
    readonly statWorktree?: (path: string) => unknown;
    readonly resolveGitCommonDir?: (path: string) => string;
  } = {},
): Registry {
  const statWorktree = options.statWorktree ?? NodeFs.statSync;
  const resolveGitCommonDir = options.resolveGitCommonDir ?? resolveGitCommonDirForWorktree;
  const assignments: Record<string, GhosttyAssignment> = {};
  for (const assignment of Object.values(registry.assignments)) {
    try {
      statWorktree(assignment.worktreeRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (
      normalizePath(resolveGitCommonDir(assignment.worktreeRoot)) !==
      normalizePath(assignment.repoCommonDir)
    ) {
      continue;
    }
    assignments[createAssignmentKey(assignment.repoCommonDir, assignment.worktreeRoot)] =
      assignment;
  }
  return { version: 1, assignments };
}

export function withoutElectronNodeMode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env };
  delete sanitized.ELECTRON_RUN_AS_NODE;
  return sanitized;
}

function spawnGhostty(commandLine: string): void {
  const result = spawnSync(
    "hyprnav",
    ["spawn", "--print-workspace-id", "rand", "--", "sh", "-lc", commandLine],
    {
      encoding: "utf8",
      env: withoutElectronNodeMode(process.env),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error) throw result.error;
  if (result.status === 0) return;
  if (
    result.stderr.includes("request_failed: connecting to") &&
    result.stderr.includes("/spawn.sock") &&
    Number.isSafeInteger(Number(result.stdout.trim()))
  ) {
    const workspaceId = Number(result.stdout.trim());
    hyprctl(["dispatch", hyprlandFocusWorkspaceDispatcher(workspaceId)]);
    hyprctl(["dispatch", hyprlandExecDispatcher(commandLine, workspaceId)]);
    return;
  }
  throw new Error(
    result.stderr.trim() || `hyprnav spawn failed with status ${String(result.status)}.`,
  );
}

async function waitForClient(className: string): Promise<HyprClient> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const match = clients().find((client) => client.className === className);
    if (match) return match;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Ghostty class ${className}.`);
}

export async function runCli(
  argv: readonly string[],
  runtime: { readonly platform: NodeJS.Platform },
): Promise<number> {
  try {
    if (runtime.platform !== "linux" || !process.env.HYPRLAND_INSTANCE_SIGNATURE?.trim()) {
      throw new Error("Hyprland does not appear to be running in this environment.");
    }
    const args = parseCliArgs(argv);
    const statePath = resolveStateFilePath(process.env);
    return await withRegistryLock(statePath, async () => {
      const registry = pruneRegistry(readRegistryRecovering(statePath));
      const openClients = clients();
      if (args.mode === "list-open") {
        const assignments: Record<string, GhosttyAssignment> = {};
        const open: Array<{ readonly worktreePath: string }> = [];
        for (const assignment of Object.values(registry.assignments)) {
          const client = liveClient(assignment, openClients);
          if (!client) continue;
          const recovered = { ...assignment, pid: client.pid };
          assignments[createAssignmentKey(recovered.repoCommonDir, recovered.worktreeRoot)] =
            recovered;
          open.push({ worktreePath: recovered.worktreeRoot });
        }
        writeRegistryAtomic(statePath, { version: 1, assignments });
        process.stdout.write(`${JSON.stringify(open)}\n`);
        return 0;
      }
      const ghostty = spawnSync("ghostty", ["+version"], { stdio: "ignore" });
      if (ghostty.error || ghostty.status !== 0) {
        throw new Error("Ghostty does not appear to be installed in PATH.");
      }
      const worktree = resolveWorktreeFromCwd(process.cwd());
      const existing = registry.assignments[worktree.key];
      const existingClient = existing ? liveClient(existing, openClients) : null;
      const className = createManagedClassName(worktree.key);
      const recoveredClient =
        existingClient ?? findManagedClientByClassName(openClients, className);
      if (recoveredClient) {
        const recovered: GhosttyAssignment = {
          repoCommonDir: worktree.repoCommonDir,
          worktreeRoot: worktree.worktreeRoot,
          className,
          title: existing?.title ?? createManagedTitle(worktree),
          pid: recoveredClient.pid,
        };
        writeRegistryAtomic(statePath, {
          version: 1,
          assignments: { ...registry.assignments, [worktree.key]: recovered },
        });
        focus(recoveredClient);
        process.stdout.write(
          `pid=${String(recovered.pid)} workspace=${String(recoveredClient.workspace)} worktree=${worktree.worktreeRoot}\n`,
        );
        return 0;
      }
      spawnGhostty(
        buildGhosttyLaunchCommand({
          className,
          cwd: worktree.cwd,
          title: createManagedTitle(worktree),
          execCommand: args.execCommand,
        }),
      );
      const client = await waitForClient(className);
      const assignment: GhosttyAssignment = {
        repoCommonDir: worktree.repoCommonDir,
        worktreeRoot: worktree.worktreeRoot,
        pid: client.pid,
        className,
        title: createManagedTitle(worktree),
      };
      writeRegistryAtomic(statePath, {
        version: 1,
        assignments: { ...registry.assignments, [worktree.key]: assignment },
      });
      focus(client);
      process.stdout.write(
        `pid=${String(client.pid)} workspace=${String(client.workspace)} worktree=${worktree.worktreeRoot}\n`,
      );
      return 0;
    });
  } catch (error) {
    process.stderr.write(
      `[ghostty-worktree] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
