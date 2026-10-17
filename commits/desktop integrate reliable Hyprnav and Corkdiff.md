# Desktop: integrate reliable Hyprnav and Corkdiff

## Goal

On Hyprland, desktop `Ctrl+D` opens or focuses one external Corkdiff Ghostty workspace per
primary-local thread through `hyprnav spawn --print-workspace-id rand -- ghostty ...`. Browser and
remote-environment threads keep the in-app diff viewer, and any external launch failure reports a
toast and opens the in-app viewer instead.

## Included Changes

- Electron main (`corkdiff/ExternalCorkdiff.ts`) owns session discovery and launch coalescing. It
  waits for the uniquely classed Ghostty client before reporting success, uses direct bounded
  argv/environment calls, and keeps immediate Hyprnav plugin/socket failures visible. Once the
  workspace id settles, the launch resolves on Hyprnav's exit rather than on pipe close, because
  the viewer inherits Hyprnav's stdio. Viewers moved to a special workspace stay owned and are
  focused by window address.
- Corkdiff gets a short-lived websocket ticket, never the cached desktop bearer token. The ticket
  travels in Corkdiff's redacted `token` query parameter, which the server accepts only as a
  websocket ticket. A supervised loop refreshes it in place through a private per-launch Neovim
  RPC socket. A ticket request that rejects the cached bearer invalidates it, re-bootstraps the
  local session, and retries once. After a desktop restart the next open adopts a reachable viewer
  and installs fresh credentials; stale viewers are closed and relaunched.
- Corkdiff returns focus through the action-only `desktop.requestCorkdiffAppFocus` RPC
  (orchestration operate scope). The server finds the desktop window with a bounded Hyprland
  client lookup on both Electron's WM class and its Wayland app ID, which the desktop passes to
  the primary backend as `T3CODE_DESKTOP_WM_CLASS` / `T3CODE_DESKTOP_WAYLAND_APP_ID`.
- The preload exposes `openExternalCorkdiff` only on Linux under Hyprland and stays free of
  external runtime packages so the sandboxed preload keeps loading.
- In the web client, upstream's `diff.toggle` command routes through `routeDiffShortcut`; the
  header diff button keeps the in-app viewer.

## Validation Coverage

`ExternalCorkdiff.test.ts` (stable classes, exact spawn arguments, ticket-only child auth and
refresh, bearer re-bootstrap, manual close, bounded output and timeouts, coalescing, stale-client
relaunch, restart recovery, focus races, readiness, immediate failures, inherited pipes,
special-workspace ownership), `DesktopFocus.test.ts`, the redacted-ticket upgrade case in
`EnvironmentAuth.test.ts`, `externalCorkdiffRouting.test.ts`, the preload sandbox import check, and
the backend environment variables in `DesktopBackendConfiguration.test.ts`.

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `9971f0320b` (itself from `51b40dfcd5`,
`103e6e5c09`, `a563f98663`). Upstream moved RPC instrumentation into `RpcInstrumentation.ts` and
removed `server.test.ts`, so the focus handler is a plain entry in the handler map and the ticket
test lives with the other upgrade tests.
