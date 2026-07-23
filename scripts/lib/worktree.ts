// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

export interface ResolvedWorktree {
  readonly cwd: string;
  readonly repoCommonDir: string;
  readonly worktreeRoot: string;
  readonly key: string;
}

export function normalizePath(value: string): string {
  return NodePath.resolve(value);
}

function git(args: readonly string[], cwd: string): string {
  return NodeChildProcess.execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function createAssignmentKey(repoCommonDir: string, worktreeRoot: string): string {
  return `${normalizePath(repoCommonDir)}::${normalizePath(worktreeRoot)}`;
}

export function resolveWorktreeFromCwd(cwd: string): ResolvedWorktree {
  const worktreeRoot = normalizePath(git(["rev-parse", "--show-toplevel"], cwd));
  const repoCommonDir = normalizePath(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd),
  );
  return {
    cwd: normalizePath(cwd),
    repoCommonDir,
    worktreeRoot,
    key: createAssignmentKey(repoCommonDir, worktreeRoot),
  };
}

export function resolveGitCommonDirForWorktree(worktreeRoot: string): string {
  return normalizePath(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktreeRoot),
  );
}
