export type CommandSurface = "command-palette" | "navigation" | "project-actions";

const COMMAND_SURFACE_SELECTOR = "[data-command-surface]";

/** Read at event time so shortcut handlers do not subscribe to transient dialog state. */
export function isCommandSurfaceOpen(surface: CommandSurface): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(`${COMMAND_SURFACE_SELECTOR}[data-command-surface="${surface}"]`) !==
      null
  );
}

export function isAnyCommandSurfaceOpen(except?: CommandSurface): boolean {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll<HTMLElement>(COMMAND_SURFACE_SELECTOR)].some(
    (element) => element.dataset.commandSurface !== except,
  );
}
