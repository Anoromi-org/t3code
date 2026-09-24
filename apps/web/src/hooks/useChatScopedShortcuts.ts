import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";

import { isAnyCommandSurfaceOpen } from "../commandSurface";
import { resolveChatScopedShortcutAction } from "../components/ChatView.logic";
import { resolveShortcutCommand, type ShortcutMatchContext } from "../keybindings";

/**
 * Chat-scoped shortcuts (`chat.composer.focus`, `thread.stop`) for the active
 * thread. Open command surfaces, the composer model picker, and events another
 * owner already handled keep control; an unavailable action leaves the event
 * alone so contextual shortcuts such as Escape still work.
 */
export function useChatScopedShortcuts({
  enabled,
  keybindings,
  canInterrupt,
  getHasComposer,
  getShortcutContext,
  onFocusComposer,
  onInterruptTurn,
}: {
  enabled: boolean;
  keybindings: ResolvedKeybindingsConfig;
  canInterrupt: boolean;
  getHasComposer: () => boolean;
  getShortcutContext: (eventTarget: EventTarget | null) => Partial<ShortcutMatchContext>;
  onFocusComposer: () => void;
  onInterruptTurn: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isAnyCommandSurfaceOpen()) return;
      const context = getShortcutContext(event.target);
      if (event.defaultPrevented && !context.terminalFocus) return;
      const command = resolveShortcutCommand(event, keybindings, { context });
      if (command !== "chat.composer.focus" && command !== "thread.stop") return;
      const action = resolveChatScopedShortcutAction({
        command,
        hasComposer: getHasComposer(),
        canInterrupt,
        modelPickerOpen: context.modelPickerOpen ?? false,
      });
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      if (action === "focus-composer") onFocusComposer();
      else onInterruptTurn();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    canInterrupt,
    enabled,
    getHasComposer,
    getShortcutContext,
    keybindings,
    onFocusComposer,
    onInterruptTurn,
  ]);
}
