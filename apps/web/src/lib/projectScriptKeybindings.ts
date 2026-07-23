import {
  KeybindingRule as KeybindingRuleSchema,
  type KeybindingCommand,
  type KeybindingRule,
  type ResolvedKeybindingsConfig,
  type ServerRemoveKeybindingInput,
  type ServerUpsertKeybindingInput,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";

export const PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE = "Invalid keybinding.";

const decodeKeybindingRule = Schema.decodeUnknownOption(KeybindingRuleSchema);

function normalizeProjectScriptKeybindingInput(
  keybinding: string | null | undefined,
): string | null {
  const trimmed = keybinding?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function decodeProjectScriptKeybindingRule(input: {
  keybinding: string | null | undefined;
  command: KeybindingCommand;
}): KeybindingRule | null {
  const normalizedKey = normalizeProjectScriptKeybindingInput(input.keybinding);
  if (!normalizedKey) return null;

  const decoded = decodeKeybindingRule({
    key: normalizedKey,
    command: input.command,
  });
  if (decoded._tag === "None") {
    throw new Error(PROJECT_SCRIPT_KEYBINDING_INVALID_MESSAGE);
  }
  return decoded.value;
}

export function keybindingValueForCommand(
  keybindings: ResolvedKeybindingsConfig,
  command: KeybindingCommand,
): string | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding || binding.command !== command) continue;

    const parts: string[] = [];
    if (binding.shortcut.modKey) parts.push("mod");
    if (binding.shortcut.ctrlKey) parts.push("ctrl");
    if (binding.shortcut.metaKey) parts.push("meta");
    if (binding.shortcut.altKey) parts.push("alt");
    if (binding.shortcut.shiftKey) parts.push("shift");
    const keyToken =
      binding.shortcut.key === " "
        ? "space"
        : binding.shortcut.key === "escape"
          ? "esc"
          : binding.shortcut.key;
    parts.push(keyToken);
    return parts.join("+");
  }
  return null;
}

export type ProjectScriptKeybindingMutation =
  | { readonly type: "none" }
  | { readonly type: "remove"; readonly input: ServerRemoveKeybindingInput }
  | { readonly type: "upsert"; readonly input: ServerUpsertKeybindingInput };

export function projectScriptKeybindingMutation(input: {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly keybinding: string | null | undefined;
  readonly command: KeybindingCommand;
}): ProjectScriptKeybindingMutation {
  const currentBindings = input.keybindings.filter((binding) => binding.command === input.command);
  const nextRule = decodeProjectScriptKeybindingRule({
    keybinding: input.keybinding,
    command: input.command,
  });

  if (!nextRule) {
    return currentBindings.length > 0
      ? { type: "remove", input: { command: input.command, all: true } }
      : { type: "none" };
  }
  if (
    currentBindings.length === 1 &&
    keybindingValueForCommand(currentBindings, input.command) === nextRule.key
  ) {
    return { type: "none" };
  }
  return {
    type: "upsert",
    input: {
      ...nextRule,
      ...(currentBindings.length > 0 ? { replaceAllForCommand: true as const } : {}),
    },
  };
}

export async function persistProjectScriptsWithKeybindingRollback(input: {
  readonly updateScripts: () => Promise<AtomCommandResult<void, unknown>>;
  readonly rollbackScripts: () => Promise<AtomCommandResult<void, unknown>>;
  readonly mutateKeybinding: () => Promise<AtomCommandResult<void, unknown>>;
}): Promise<AtomCommandResult<void, unknown>> {
  const updateResult = await input.updateScripts();
  if (updateResult._tag === "Failure") return updateResult;

  const keybindingResult = await input.mutateKeybinding();
  if (keybindingResult._tag === "Success") return keybindingResult;

  await input.rollbackScripts();
  return keybindingResult;
}

export async function persistProjectScriptsAndKeybinding<Script>(input: {
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly keybinding: string | null | undefined;
  readonly command: KeybindingCommand;
  readonly persistKeybindings: boolean;
  readonly previousScripts: ReadonlyArray<Script>;
  readonly nextScripts: ReadonlyArray<Script>;
  readonly updateScripts: (
    scripts: ReadonlyArray<Script>,
  ) => Promise<AtomCommandResult<void, unknown>>;
  readonly upsertKeybinding: (
    input: ServerUpsertKeybindingInput,
  ) => Promise<AtomCommandResult<void, unknown>>;
  readonly removeKeybinding: (
    input: ServerRemoveKeybindingInput,
  ) => Promise<AtomCommandResult<void, unknown>>;
}): Promise<AtomCommandResult<void, unknown>> {
  const mutation = projectScriptKeybindingMutation(input);
  const mutateKeybinding = () => {
    if (!input.persistKeybindings || mutation.type === "none") {
      return Promise.resolve(AsyncResult.success(undefined));
    }
    return mutation.type === "upsert"
      ? input.upsertKeybinding(mutation.input)
      : input.removeKeybinding(mutation.input);
  };
  return persistProjectScriptsWithKeybindingRollback({
    updateScripts: () => input.updateScripts(input.nextScripts),
    rollbackScripts: () => input.updateScripts(input.previousScripts),
    mutateKeybinding,
  });
}
