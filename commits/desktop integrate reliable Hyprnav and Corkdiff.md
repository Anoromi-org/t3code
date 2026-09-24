# Desktop: integrate reliable Hyprnav and Corkdiff

Desktop `Ctrl+D` opens or focuses one external Corkdiff Ghostty workspace per primary-local thread through `hyprnav spawn --print-workspace-id rand -- ghostty ...`. Browser and remote-environment threads retain the in-app diff viewer, and any external launch failure reports a toast and opens the in-app viewer instead.

Electron main owns session discovery and launch coalescing. It waits for the uniquely classed Ghostty client before reporting success, uses direct bounded argv/environment calls, and preserves immediate Hyprnav plugin/socket failures. Once the workspace id settles, the launch resolves on Hyprnav's exit rather than on pipe close, because the spawned viewer inherits Hyprnav's stdio. Viewers moved to a Hyprland special workspace stay owned and are focused by window address.
It mints a short-lived websocket ticket for Corkdiff and never exposes the cached desktop bearer token to the child process.
The ticket uses Corkdiff's existing redacted `token` query parameter, which the server accepts only as a websocket ticket; access tokens remain rejected there.
Before expiry, a supervised refresh loop rotates the ticket in place through a private per-launch Neovim RPC socket and stops if the user closed the viewer.
If ticket issuance explicitly rejects the cached bearer, Electron invalidates it, re-bootstraps its local session, and retries once; transient ticket failures preserve the cached session.
After Electron loses session ownership during a restart, the next open adopts a reachable viewer through its deterministic Neovim socket and installs fresh credentials. Stale or unreachable viewers are closed and relaunched.

Corkdiff returns focus through the action-only `desktop.requestCorkdiffAppFocus` RPC (orchestration operate scope). The server performs a bounded Hyprland client lookup using both Electron's configured WM class and native Wayland app ID, which the desktop passes to the primary backend as `T3CODE_DESKTOP_WM_CLASS` / `T3CODE_DESKTOP_WAYLAND_APP_ID`, then focuses the desktop window directly; no renderer subscription or event stream is added.

The preload exposes `openExternalCorkdiff` only on Linux under Hyprland, and stays free of external runtime packages so the sandboxed preload keeps loading.

## Reimplementation Sources

This intent reimplements fork commit `51b40dfcd5` (itself folding `103e6e5c09` and `a563f98663`) against upstream's current Electron IPC handler/channel registry, websocket handler map, RPC scope table, remote websocket URL helpers, and chat keyboard handling. The transient command-palette reassignment is intentionally omitted; the final shortcut contract remains `Ctrl/Cmd+K` for the command palette and reserves `Ctrl/Cmd+E` for navigation.

## Validation Coverage

Preserve stable per-thread Ghostty classes, exact direct spawn arguments, ticket-only child authentication and in-place refresh, bearer re-bootstrap, manual-close handling, bounded output and command timeouts, concurrent launch coalescing, stale-client relaunch, restart recovery, focus races, observable-client readiness, immediate spawn failure surfacing, launch settlement while the viewer holds inherited pipes, special-workspace ownership, X11/Wayland app-ID lookup, the redacted `token` websocket ticket handshake next to the existing access-token rejection, sandbox-safe preload imports, and primary-local renderer fallback scenarios.
