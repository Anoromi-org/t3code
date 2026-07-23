import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { useEffect } from "react";

import { isAnyCommandSurfaceOpen } from "../commandSurface";
import { resolveChatScopedShortcutAction } from "../components/ChatView.logic";
import { resolveShortcutCommand, type ShortcutMatchContext } from "../keybindings";
import type { Thread } from "../types";

export function useChatScopedShortcuts({
  enabled,
  keybindings,
  sessionStatus,
  getHasComposer,
  getShortcutContext,
  onFocusComposer,
  onInterruptTurn,
}: {
  enabled: boolean;
  keybindings: ResolvedKeybindingsConfig;
  sessionStatus: NonNullable<Thread["session"]>["status"] | null;
  getHasComposer: () => boolean;
  getShortcutContext: () => Partial<ShortcutMatchContext>;
  onFocusComposer: () => void;
  onInterruptTurn: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isAnyCommandSurfaceOpen()) return;
      const context = getShortcutContext();
      if (context.modelPickerOpen) return;
      const command = resolveShortcutCommand(event, keybindings, { context });
      const action = resolveChatScopedShortcutAction({
        command,
        hasComposer: getHasComposer(),
        session: sessionStatus === null ? null : { status: sessionStatus },
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
    enabled,
    getHasComposer,
    getShortcutContext,
    keybindings,
    onFocusComposer,
    onInterruptTurn,
    sessionStatus,
  ]);
}
