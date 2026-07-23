import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import { projectKeybindingsForClient } from "./keybindingsCompatibility.ts";

const shortcut = {
  key: "k",
  metaKey: false,
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  modKey: true,
} as const;

const keybindings = [
  { command: "navigation.commandMenu", shortcut },
  { command: "projectActions.toggle", shortcut },
  { command: "chat.composer.focus", shortcut },
  { command: "thread.interrupt", shortcut },
  { command: "terminal.toggle", shortcut },
  { command: "script.mobile-safe.run", shortcut },
] satisfies ResolvedKeybindingsConfig;

it("removes commands unsupported by the current mobile client schema", () => {
  assert.deepEqual(projectKeybindingsForClient(keybindings, "mobile", "bearer-access-token"), [
    { command: "terminal.toggle", shortcut },
    { command: "script.mobile-safe.run", shortcut },
  ]);
  assert.deepEqual(projectKeybindingsForClient(keybindings, "mobile", "dpop-access-token"), [
    { command: "terminal.toggle", shortcut },
    { command: "script.mobile-safe.run", shortcut },
  ]);
});

it("preserves the complete config for non-mobile and unknown clients", () => {
  assert.strictEqual(
    projectKeybindingsForClient(keybindings, "desktop", "bearer-access-token"),
    keybindings,
  );
  assert.strictEqual(
    projectKeybindingsForClient(keybindings, "unknown", "bearer-access-token"),
    keybindings,
  );
});

it("preserves the complete config for mobile browser sessions", () => {
  assert.strictEqual(
    projectKeybindingsForClient(keybindings, "mobile", "browser-session-cookie"),
    keybindings,
  );
});
