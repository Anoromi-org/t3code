# hyprnav restore runtime, settings, desktop agents, and lock sync

## Goal

Restore the fork's Hyprnav integration on upstream's current desktop, server, and web structure:
scoped environment publication and locking, project and device settings, worktree terminals,
browser slots, environment titles, following the hyprnav lock to its thread, and the list and
live view of hyprnav desktop (computer-use) agents.

## Included Changes

- **Desktop runtime** (`apps/desktop/src/hyprnav/`). `HyprnavEnvironment` performs atomic scoped
  slot sync, locking, naming, workspace targets, favorite-editor and shell-command bindings,
  no-op bindings, external Corkdiff commands, browser tabs, and project/worktree titles.
  `WorktreeTerminal` launches or focuses per-worktree Ghostty sessions through the standalone
  `ghostty-worktree.cjs` helper, which ships as a desktop extra resource and supports the Nix
  app-root layout. The preload gates these behind `canUseHyprlandIntegrations` (Linux under
  Hyprland). Unavailable dependencies return explicit status results.
- **Renderer runtime.** `HyprnavRuntimeOrchestrator` (mounted in `ThreadRouteView` for server
  threads that are in the foreground; upstream keeps a thread mounted inert under Settings) publishes and locks the current thread environment for the primary environment, with
  retries, partial-scope acknowledgement, superseded-publication cancellation, persisted slot
  history, Corkdiff ticket refresh, and a semantic request fingerprint.
- **Settings.** Device-local defaults, lock behavior, and browser slots live on
  `/settings/hyprnav` (`_chat.settings.hyprnav.tsx`, in the Preferences group). Project overrides are a Hyprnav section in upstream's scope-driven project
  settings. In grouped `same` mode a save writes every checkout; in `separate` mode it edits one
  checkout. Overrides stay in `projection_projects.hyprnav_json` through the v2 project contract.
  Saves persist before best-effort desktop publication and return `{ text, warning }`, so the
  warning style does not depend on the English wording. Upstream deleted the legacy sidebar, so
  its "Hyprnav settings" project-menu action is gone; Settings search and the project page reach it.
- **Server routes** (`hyprnavRoutes.ts`, loopback only): `/api/hyprnav/{agents,events,frames,
  screencast,goto}` wrap the hyprnav CLI. `hyprnavEvents.ts` brokers agent and `locked` events
  over SSE, and `hyprnavFrames.ts` negotiates video codecs for an agent window's frames.
- **Desktop agents.** The agent list (Watch and Go there) lives in the thread details panel,
  because upstream removed the right-panel Agents surface. A working agent's window floats in
  the thread mini player as a third `desktop-agent` source, decoded with WebCodecs and falling
  back to MJPEG. The agent's decoded frame size lives in a store the chat canvas reads, because
  upstream lays the mini player out from the canvas. Its "open in panel" opens the thread details
  panel. The Watch action installs the main window's display-media handler on first use and arms
  it; any other request is denied. Upstream's recording handler replaces it on the same session
  and defers to it when no recording is armed.
- **Lock follow.** `HyprnavLockFollower` (in `AppSidebarLayout`) follows the hyprnav lock to its
  thread when `hyprnavFollowLock` is on (default: desktop app only). `hyprnavPublishLock` controls
  whether T3 locks the opened thread's environment.
- Fork browser tests use upstream's disposable `render` from `apps/web/test/render.tsx`.
- All fork copy is translated in every web locale.

## Dropped or deferred

- Functional, per-environment-serialized provider-instance settings updates
  (`ProviderSettingsPanel`, `AddProviderInstanceDialog`, model picker favorites). Upstream
  rewrote the settings write path and serializes client writes through
  `persistClientSettingsUpdate`. Revisit if rapid provider edits are seen to drop changes.

## Validation Coverage

Desktop: `HyprnavEnvironment`, `WorktreeTerminal`, `HyprnavScreencast`, IPC method tests, the
packaging extra-resource assertion, and `ghostty-worktree` script tests. Server: event broker,
frames, and route tests. Web unit: runtime, settings, browser slots, event stream, lock follower,
codecs, frame records, mini-player store and layout, and agent mini-player store. Web browser:
the orchestrator, the binding editor, the grouped project section, and settings navigation.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `2a17e359cf` (previously onto `13aa882c22`
from `bcb6fdac4e`, `a9b8f60da0`, `e5957c94d0`, `0779a4cb61`, `325d0fb78d`, and `fee2ca7f9b`). The
desktop learning-contract test lands with the learning contract unit.
