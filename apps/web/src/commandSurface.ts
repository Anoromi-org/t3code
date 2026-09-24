export type CommandSurface = "command-palette" | "navigation" | "project-actions";

const COMMAND_SURFACE_SELECTOR = "[data-command-surface]";

/** Whether the given modal command surface is open, read at event time. */
export function isCommandSurfaceOpen(surface: CommandSurface): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(`${COMMAND_SURFACE_SELECTOR}[data-command-surface="${surface}"]`) !==
      null
  );
}

/**
 * Whether a modal command surface other than `except` is open. Read at event
 * time so global shortcut handlers do not subscribe to transient dialog state.
 */
export function isAnyCommandSurfaceOpen(except?: CommandSurface): boolean {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll<HTMLElement>(COMMAND_SURFACE_SELECTOR)].some(
    (element) => element.dataset.commandSurface !== except,
  );
}
