# Desktop: integrate reliable Hyprnav and Corkdiff

Desktop `Ctrl+D` opens or focuses one external Corkdiff Ghostty workspace per primary-local thread through `hyprnav spawn --print-workspace-id rand -- ghostty ...`. Browser and remote-environment threads retain the in-app diff viewer.

Electron main owns session discovery and launch coalescing. It waits for the uniquely classed Ghostty client before reporting success, uses direct bounded argv/environment calls, and preserves immediate Hyprnav plugin/socket failures.
It mints a short-lived websocket ticket for Corkdiff and never exposes the cached desktop bearer token to the child process.
The ticket uses Corkdiff's existing redacted `token` query parameter, which the server accepts only as a websocket ticket; access tokens remain rejected there.
Before expiry, a supervised refresh loop rotates the ticket in place through a private per-launch Neovim RPC socket and stops if the user closed the viewer.
If ticket issuance explicitly rejects the cached bearer, Electron invalidates it, re-bootstraps its local session, and retries once; transient ticket failures preserve the cached session.
After Electron loses session ownership during a restart, the next open adopts a reachable viewer through its deterministic Neovim socket and installs fresh credentials. Stale or unreachable viewers are closed and relaunched.

Corkdiff returns focus through the action-only `desktop.requestCorkdiffAppFocus` RPC. The server performs a bounded Hyprland client lookup using both Electron's configured WM class and native Wayland app ID, then focuses the desktop window directly; no renderer subscription or event stream is added.

## Reimplementation Sources

This intent reimplements source commits `103e6e5c09` and `a563f98663` against upstream's current Electron IPC, SSH environment, preview, websocket, and chat surfaces. The transient command-palette reassignment is intentionally omitted; the final shortcut contract remains `Ctrl/Cmd+K` for the command palette and reserves `Ctrl/Cmd+E` for navigation.

## Validation Coverage

Preserve stable per-thread Ghostty classes, exact direct spawn arguments, ticket-only child authentication and in-place refresh, bearer re-bootstrap, manual-close handling, bounded output and command timeouts, concurrent launch coalescing, stale-client relaunch, restart recovery, focus races, observable-client readiness, immediate spawn failure surfacing, X11/Wayland app-ID lookup, and primary-local renderer fallback scenarios.
