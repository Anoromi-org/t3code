import type { ScopedThreadRef } from "@t3tools/contracts";

import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";

/** Shortcut context for layout-level key handlers, read from stores at event time. */
export function resolveLayoutShortcutContext(
  event: KeyboardEvent,
  routeThreadRef: ScopedThreadRef | null,
) {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: routeThreadRef
      ? selectThreadTerminalUiState(
          useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
          routeThreadRef,
        ).terminalOpen
      : false,
    previewFocus: isPreviewFocused(),
    previewOpen: routeThreadRef
      ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
        "preview"
      : false,
    editableFocus: isEditableFocused(event.target),
    modelPickerOpen: isModelPickerOpen(),
  };
}
