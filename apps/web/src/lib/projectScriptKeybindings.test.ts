import { MAX_KEYBINDING_VALUE_LENGTH, type KeybindingCommand } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { commandForProjectScript } from "../projectScripts";
import {
  decodeProjectScriptKeybindingRule,
  keybindingValueForCommand,
  persistProjectScriptsAndKeybinding,
  persistProjectScriptsWithKeybindingRollback,
  projectScriptKeybindingMutation,
  PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE,
} from "./projectScriptKeybindings";

describe("projectScriptKeybindings", () => {
  it("decodes and trims valid keybinding rules", () => {
    const rule = decodeProjectScriptKeybindingRule({
      keybinding: "  mod+k  ",
      command: commandForProjectScript("lint"),
    });

    expect(rule).toEqual({
      key: "mod+k",
      command: "script.lint.run",
    });
  });

  it("returns null when keybinding is empty", () => {
    expect(
      decodeProjectScriptKeybindingRule({
        keybinding: "   ",
        command: commandForProjectScript("lint"),
      }),
    ).toBeNull();
  });

  it("rejects invalid keybinding values", () => {
    expect(() =>
      decodeProjectScriptKeybindingRule({
        keybinding: "k".repeat(MAX_KEYBINDING_VALUE_LENGTH + 1),
        command: commandForProjectScript("lint"),
      }),
    ).toThrowError(PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE);
  });

  it("rejects invalid commands", () => {
    expect(() =>
      decodeProjectScriptKeybindingRule({
        keybinding: "mod+k",
        command: "script.BAD.run" as KeybindingCommand,
      }),
    ).toThrowError(PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE);
  });

  it("reads latest matching keybinding value for a command", () => {
    const command = commandForProjectScript("test");
    const value = keybindingValueForCommand(
      [
        {
          command,
          shortcut: {
            key: "escape",
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            modKey: true,
          },
        },
        {
          command,
          shortcut: {
            key: "k",
            metaKey: false,
            ctrlKey: false,
            shiftKey: true,
            altKey: false,
            modKey: true,
          },
        },
      ],
      command,
    );

    expect(value).toBe("mod+shift+k");
  });

  it("removes the persisted project shortcut when it is cleared", () => {
    const command = commandForProjectScript("test");

    expect(
      projectScriptKeybindingMutation({
        keybindings: [
          {
            command,
            shortcut: {
              key: "k",
              metaKey: false,
              ctrlKey: false,
              shiftKey: true,
              altKey: false,
              modKey: true,
            },
          },
        ],
        keybinding: null,
        command,
      }),
    ).toEqual({
      type: "remove",
      input: { command, all: true },
    });
  });

  it("replaces the persisted project shortcut when it changes", () => {
    const command = commandForProjectScript("test");

    expect(
      projectScriptKeybindingMutation({
        keybindings: [
          {
            command,
            shortcut: {
              key: "k",
              metaKey: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              modKey: true,
            },
          },
        ],
        keybinding: "mod+t",
        command,
      }),
    ).toEqual({
      type: "upsert",
      input: {
        command,
        key: "mod+t",
        replaceAllForCommand: true,
      },
    });
  });

  it("clears every persisted shortcut for a project action", () => {
    const command = commandForProjectScript("test");
    const shortcut = (key: string) => ({
      command,
      shortcut: {
        key,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        modKey: true,
      },
    });

    expect(
      projectScriptKeybindingMutation({
        keybindings: [shortcut("k"), shortcut("t")],
        keybinding: null,
        command,
      }),
    ).toEqual({ type: "remove", input: { command, all: true } });
  });

  it("rolls back the project update when shortcut persistence fails", async () => {
    const calls: string[] = [];
    const keybindingFailure: AtomCommandResult<void, unknown> = AsyncResult.failure(
      Cause.fail(new Error("read-only config")),
    );

    const result = await persistProjectScriptsWithKeybindingRollback({
      updateScripts: async () => {
        calls.push("update");
        return AsyncResult.success(undefined);
      },
      mutateKeybinding: async () => {
        calls.push("keybinding");
        return keybindingFailure;
      },
      rollbackScripts: async () => {
        calls.push("rollback");
        return AsyncResult.success(undefined);
      },
    });

    expect(calls).toEqual(["update", "keybinding", "rollback"]);
    expect(result).toBe(keybindingFailure);
  });

  it("wires multi-binding removal and script rollback as one persistence operation", async () => {
    const command = commandForProjectScript("test");
    const calls: string[] = [];
    const failure: AtomCommandResult<void, unknown> = AsyncResult.failure(
      Cause.fail(new Error("read-only config")),
    );
    const result = await persistProjectScriptsAndKeybinding({
      keybindings: ["k", "t"].map((key) => ({
        command,
        shortcut: {
          key,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      })),
      keybinding: null,
      command,
      persistKeybindings: true,
      previousScripts: ["old"],
      nextScripts: [],
      updateScripts: async (scripts) => {
        calls.push(`scripts:${scripts.join(",")}`);
        return AsyncResult.success(undefined);
      },
      upsertKeybinding: async () => AsyncResult.success(undefined),
      removeKeybinding: async (input) => {
        calls.push(`remove:${input.command}:${"all" in input ? input.all : false}`);
        return failure;
      },
    });

    expect(calls).toEqual(["scripts:", `remove:${command}:true`, "scripts:old"]);
    expect(result).toBe(failure);
  });
});
