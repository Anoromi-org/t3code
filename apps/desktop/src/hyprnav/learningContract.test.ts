// @effect-diagnostics nodeBuiltinImport:off
/**
 * Learning-service contract, hyprnav half.
 *
 * The personal learning service (`~/code/experiments/learning-service`) puts a
 * "Lesson" button on hyprnav slot 3 of lesson threads:
 *
 *   - slot/slot3-binding.json  the project binding below (thread scope, shell-command).
 *   - slot/open-lesson         reads the thread id from `$1`, which T3 Code fills by
 *                              substituting `{threadId}` shell-quoted, else from
 *                              `$T3CODE_THREAD_ID`.
 *
 * If this fails after a rebase onto upstream, slot 3 stops opening lessons:
 * fix the sync, or change the learning service in the same step. The HTTP half
 * of the contract is pinned in apps/server/src/learningContract.test.ts.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";

import { ProjectHyprnavSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import { expandHyprnavCommandTemplate, HyprnavEnvironmentManager } from "./HyprnavEnvironment.ts";

const OPEN_LESSON = "/home/anoromi/code/experiments/learning-service/slot/open-lesson";

// learning-service slot/slot3-binding.json, `hyprnav` member, verbatim.
const SLOT3_BINDING_JSON = {
  bindings: [
    {
      id: "worktree-terminal",
      slot: 1,
      scope: "worktree",
      workspace: { mode: "managed" },
      action: "worktree-terminal",
    },
    {
      id: "open-favorite-editor",
      slot: 2,
      scope: "worktree",
      workspace: { mode: "managed" },
      action: "open-favorite-editor",
    },
    {
      id: "lesson-page",
      slot: 3,
      scope: "thread",
      workspace: { mode: "managed" },
      name: "Lesson",
      action: "shell-command",
      command: `${OPEN_LESSON} {threadId}`,
    },
    {
      id: "corkdiff-viewer",
      slot: 8,
      scope: "thread",
      workspace: { mode: "managed" },
      action: "shell-command",
      command: "{corkdiffLaunchCommand}",
    },
  ],
};

const decodeHyprnavSettings = Schema.decodeUnknownSync(ProjectHyprnavSettings);

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

describe("learning-service hyprnav slot 3 contract", () => {
  it("decodes the slot3-binding.json bindings unchanged", () => {
    const decoded = decodeHyprnavSettings(SLOT3_BINDING_JSON);
    expect(decoded.bindings.find((binding) => binding.slot === 3)).toEqual(
      SLOT3_BINDING_JSON.bindings[2],
    );
  });

  it("substitutes {threadId} shell-quoted", () => {
    expect(
      expandHyprnavCommandTemplate(`${OPEN_LESSON} {threadId}`, {
        projectRoot: "/repo",
        targetPath: "/repo",
        threadId: "thread-1",
        corkdiffConnection: null,
      }),
    ).toEqual({ ok: true, command: `${OPEN_LESSON} 'thread-1'` });
    // Any quoting style is fine as long as the shell hands open-lesson the id as one `$1`.
    const hostile = 'it\'s; $(echo pwned) `id` "two words"';
    const expansion = expandHyprnavCommandTemplate("printf %s {threadId}", {
      projectRoot: "/repo",
      targetPath: "/repo",
      threadId: hostile,
      corkdiffConnection: null,
    });
    expect(expansion.ok).toBe(true);
    if (!expansion.ok) return;
    expect(
      NodeChildProcess.execFileSync("sh", ["-c", expansion.command], { encoding: "utf8" }),
    ).toBe(hostile);
  });

  it("syncs slot 3 on the thread environment as `sh -lc <open-lesson 'threadId'>`", async () => {
    const calls: Array<{ args: readonly string[]; child: MockChild }> = [];
    const spawn = vi.fn((_command: string, args: readonly string[]) => {
      const child = new MockChild();
      calls.push({ args, child });
      return child as unknown as NodeChildProcess.ChildProcess;
    });
    const manager = new HyprnavEnvironmentManager({
      spawn: spawn as unknown as typeof NodeChildProcess.spawn,
      resolvePath: (path) => path,
      realpathSync: (path) => path,
      commandAvailable: () => false,
    });
    const lessonBinding = decodeHyprnavSettings(SLOT3_BINDING_JSON).bindings.filter(
      (binding) => binding.slot === 3,
    );
    const result = manager.sync({
      projectRoot: "/repo",
      worktreePath: null,
      threadId: "thread-lesson",
      threadTitle: "Learn: monads",
      hyprnav: { bindings: lessonBinding },
      lock: false,
    });

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.args).toEqual(["--origin", "t3code", "batch", "--stdin"]);
    const payload = JSON.parse(calls[0]!.child.stdin.writes.join("")) as {
      operations: Array<Record<string, unknown>>;
    };
    const commandSet = payload.operations.find((operation) => operation.op === "slot_command_set");
    expect(commandSet).toMatchObject({
      slot: 3,
      env: expect.stringMatching(/\.t\.thread-lesson$/u),
      argv: ["sh", "-lc", `${OPEN_LESSON} 'thread-lesson'`],
      display_name: "Lesson",
    });
    expect(payload.operations).toContainEqual(
      expect.objectContaining({ op: "slot_assign", slot: 3, assignment_mode: { mode: "managed" } }),
    );
    calls[0]!.child.succeed();
    await expect(result).resolves.toMatchObject({ status: "ok" });
  });
});
