export type CommandSurface = "command-palette" | "navigation";

/**
 * Whether a modal command surface other than `except` is open. Read at event
 * time so global shortcut handlers do not subscribe to transient dialog state.
 */
export function isAnyCommandSurfaceOpen(except?: CommandSurface): boolean {
  if (typeof document === "undefined") return false;
  return [...document.querySelectorAll<HTMLElement>("[data-command-surface]")].some(
    (element) => element.dataset.commandSurface !== except,
  );
}
