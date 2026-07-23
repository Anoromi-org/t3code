import { isCommandSurfaceOpen } from "./commandSurface";

/** Read at event time so global shortcuts do not subscribe to transient dialog state. */
export function isNavigationCommandMenuOpen(): boolean {
  return isCommandSurfaceOpen("navigation");
}
