# Web add fast mode and chat shortcuts

Add `/fast` and chat-scoped shortcuts: `Mod+Shift+S` focuses the composer and `Mod+Shift+C`
stops the running turn. Upstream's `Mod+S` stash, terminals, the model picker and command
surfaces keep priority.

## Reimplementation Sources

This reimplements fork commit `0198e373ba` on upstream `e4eb9977f0`.

- `/fast` works on resolved selections. `resolveFastModeDescriptor` applies upstream's
  `withImplicitFastModeDefault` (#2981), so a provider that defaults to Fast (Cursor) reads as off
  until the user picks it, the same as the traits picker. It toggles either the legacy boolean
  `fastMode` or a `serviceTier` select with Fast and Standard tiers. The menu item appears, and a
  typed `/fast` runs, only with a live fast control and an otherwise empty composer (no images,
  files, terminal pills including expired ones, preview annotations or review comments). A queued
  message or a multi-model send never runs it, and the menu hides it while several models are
  selected. A typed `/fast` also runs while a plan follow-up is offered, like the menu item.
  Without a fast control, `/fast` goes to the provider as text. `/plan` and `/default` stay behind
  the plan-mode setting.
- Upstream's `thread.stop` replaces the fork's `thread.interrupt`, now with `Mod+Shift+C` as its
  default. `chat.composer.focus` is new. Both are handled by `hooks/useChatScopedShortcuts.ts`,
  a capture-phase window listener that ChatView mounts for the active thread, through
  `resolveChatScopedShortcutAction`. ChatView's main key handler ignores both commands. The hook
  yields to open command surfaces (including project actions), the model picker, and events
  another listener already prevented. Its browser tests are the fork's nine cases adapted to
  `thread.stop`. Either command lets the keys through when it has nothing to act on (no composer,
  nothing running, model picker open). `onInterrupt` holds a per-thread
  `acquireScopedActionLock`, so the stop button and the shortcut send only one interrupt.
- Settling moves to `Mod+Alt+Shift+S` and copying a thread reference to `Mod+Alt+Shift+C`. The
  server renames stored `thread.interrupt` rules to `thread.stop` and keeps their keys (the same
  rename path as `commandBar.toggle`). It moves an exact generated `mod+shift+s` settle or
  `mod+shift+c` copy-reference rule only while the file has no `chat.composer.focus` (settle) or
  `thread.stop`/`thread.interrupt` (copy reference) rule, and never onto an occupied key. Each move
  has its own gate in `MOVED_GENERATED_DEFAULTS`, separate from the project-actions gate.
- The fork's mobile keybinding filter (`keybindingsCompatibility.ts`, the `client` field on
  `AuthenticatedSession`, and its four `ws.ts` call sites) is dropped. `ResolvedKeybindingsConfig`
  is a `ForwardCompatibleArray` (#5055, already in the old base), so every client drops commands it
  cannot decode one element at a time. No fork mobile build is older than that.

## Validation Coverage

Node tests cover `/fast` parsing and every context guard, including expired terminal pills. They
also cover service-tier and legacy boolean toggling, rejecting non-fast descriptors, keeping
unrelated selections, and the implicit Normal default (a provider Fast default, turning off an
explicit Fast, and agreement with the composer's dispatch options). Other node tests cover
chat-scoped action resolution and the per-thread lock, and default resolution for all six
`Mod+(Alt+)Shift+S/C/P` actions. Server tests cover the new defaults, preserved custom chat
shortcuts, the `thread.interrupt` rename on a real fork file, the gated settle/copy-reference
moves and their no-repeat case, and backfilling focus next to a stash rule. A contracts test
checks that an unknown keybinding command is dropped. Chromium tests cover keyboard `/fast`
toggling with sticky persistence, unsupported `/fast` submission, `/fast` with attached context,
`/fast` hidden for multi-model sends, `/fast` in the bare slash menu (rich-text and plain modes),
and navigation status indicators.
