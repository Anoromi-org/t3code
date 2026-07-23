/** Read at event time so global shortcuts do not subscribe to transient dialog state. */
export function isNavigationCommandMenuOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector("[data-navigation-command-menu]") !== null
  );
}
