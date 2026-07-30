import type { DesktopThreadSwitcherAction } from "@t3tools/contracts";
import type * as Electron from "electron";

export interface DesktopThreadSwitcherInputController {
  readonly beforeInput: (event: Electron.Event, input: Electron.Input) => void;
  readonly onBlur: () => void;
  readonly isActive: () => boolean;
}

export function isDesktopThreadSwitcherForwardInput(
  input: Electron.Input,
  gestureActive = false,
): boolean {
  const key = input.key.toLowerCase();
  return (
    (input.type === "keyDown" && key === "tab" && input.control && !input.meta && !input.alt) ||
    (gestureActive &&
      ((input.type === "keyUp" && (key === "control" || key === "ctrl")) ||
        (input.type === "keyDown" && key === "escape")))
  );
}

export function makeDesktopThreadSwitcherInputController(
  dispatch: (action: DesktopThreadSwitcherAction) => void,
): DesktopThreadSwitcherInputController {
  let active = false;

  const finish = (action: "commit" | "cancel") => {
    if (!active) return;
    active = false;
    dispatch(action);
  };

  return {
    beforeInput: (event, input) => {
      const key = input.key.toLowerCase();
      if (input.type === "keyDown" && key === "tab" && input.control && !input.meta && !input.alt) {
        event.preventDefault();
        active = true;
        dispatch(input.shift ? "advance-backward" : "advance-forward");
        return;
      }

      if (!active) return;

      if (input.type === "keyDown" && key === "escape") {
        event.preventDefault();
        finish("cancel");
        return;
      }

      if (input.type === "keyUp" && (key === "control" || key === "ctrl")) {
        event.preventDefault();
        finish("commit");
      }
    },
    onBlur: () => finish("commit"),
    isActive: () => active,
  };
}
