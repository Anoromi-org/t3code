# Desktop: show Hyprnav desktop agents with a live window view

## Goal

Computer-use agents registered with hyprnav appear in the Agents panel with their state and last action, a Watch action, and Go there (`hyprnav goto`). When an agent starts working for a thread, the thread's floating mini player shows the agent's window and closes 5 seconds after the agent finishes. It stays open while the agent is idle between actions. Closing it by hand suppresses that agent until its state changes.

## Provenance

Squash of fork commits `23390d84f7`, `c78511f63a`, `0611d88a93`, `1888983f2a`, `0e3a392c1b`, `348da3b1d5`, `4ac57a8603`, `5c05f2bf74`, `8fd42f0b9c`, `1d51df5689`, `521fbcb98b`, `988b4584ba`, `c6ccd3ac00` and `6a73ab1655`.

- The `T3CODE_THREAD_ID` / `T3CODE_ENVIRONMENT_ID` export from `0e3a392c1b` landed with `server reconcile Codex resume and scope MCP thread context`; hyprnav reports them back as optional `thread_id` / `thread_environment_id`, so older daemons still decode.
- The fork's `FloatingMiniPlayerShell` and its `ThreadPreviewMiniPlayer` refactor are dropped. Upstream's preview mini player already floats browser tabs and devices through one `MiniPlayerShell`, so the agent's window is a third `PreviewMiniPlayerSource` kind instead of a second store and a second player.

## Server

`apps/server/src/hyprnavRoutes.ts` serves `/api/hyprnav/{agents,screencast,goto,events,frames}` from `makeRoutesLayer`.

- Every route answers 404 unless the Host header names a loopback host, the peer is loopback too when the socket is known, and any Origin header is the desktop renderer (`t3code://app`, `t3code-dev://app`) or a loopback page. The fork checked only the Host header, which a LAN client can set. Requests through Tailscale Serve or a tunnel reach the server from loopback but carry their public host, so they still fail. The Origin check matters because production CORS allows any origin, so without it any website open in a local browser could read the agent list and window frames.
- Deferred: in shared dev (`vp run dev --share`) the Vite proxy rewrites Host (`changeOrigin`) and sends no `X-Forwarded-*`, so a remote browser on the dev origin passes the loopback check. Same-origin GETs carry no Origin, so it can list agents and stream their windows. This only affects dev sharing. The fork has the same behavior.
- `screencast` and `goto` read only `application/json` bodies, so a cross-site `text/plain` form post cannot reach the CLI.
- `frames` also requires the window to be a registered agent's current target or an attached window, because the Vite dev proxy passes the loopback check for any local browser. It forwards a filtered codec list (`mjpeg` always appended), a width rounded up to a tier, `max_fps` and `follow` onto the daemon request line, and uses the first bytes of the body to tell the `HNVF` record stream from multipart JPEG.
- `events` holds one ref-counted connection to hyprnav's event socket per process, reconnects with 1 s to 10 s backoff, streams `agents`, `slots` and `status`, sends a heartbeat every 15 s, and opts out of compression with `Content-Encoding: identity`.
- The CLI runner is a `HyprnavCli` context reference, so tests use a fake CLI. `T3CODE_HYPRNAV_EVENTS_SOCKET` / `T3CODE_HYPRNAV_FRAMES_SOCKET` point at fake daemons.

## Desktop

- IPC `listHyprnavAgents`, `requestHyprnavScreencast` and `gotoHyprnavAgent` sit next to the other hyprnav entries and are exposed only when `canUseHyprlandIntegrations`. Agent entries are decoded one at a time, so one unreadable entry does not empty the list.
- Main windows get a display-media handler (Linux only, platform injected from `HostProcessPlatform`), and the preview manager's recording handler falls back to it when no tab recording is armed. Unlike the fork, the fallback only reaches the system portal for 15 seconds after `requestHyprnavScreencast` armed it, and only once. Every other request is still denied, as upstream intends (`denies a display-media request that arrives after the arm went stale`).
- `T3CODE_DESKTOP_BACKEND_CWD` overrides the embedded backend's working directory (dev lab use).

## Web

- `desktopAgentsStore.ts` holds one module-level EventSource shared by the Agents panel, the mini player host and the player. It falls back to polling when EventSource is unavailable, fails three times, or closes for good (a 404 from an older server or a non-loopback host). Inside Electron the polling fallback uses the desktop bridge. Everywhere else it uses the loopback routes and stops polling on a 404.
- `DesktopAgentsSection` in `AgentsPanel` lists live agents. Watch uses `getDisplayMedia` with the portal pre-answer posted on pointerdown, because Firefox spends transient activation on the first await. Status dots are static, like the rest of the panel.
- `PreviewMiniPlayerSource` gains `{ kind: "desktop-agent", agentId, address }`. The source key includes the address, so a retarget replaces the stream while position and width carry over. `ThreadPreviewMiniPlayer` renders it in upstream's `MiniPlayerShell`. The source size is a nominal 1920-wide box at the decoded frame's aspect (`resolveDesktopAgentMiniPlayerSourceSize`, 16:9 until the first frame), so the capture tier does not cap how big the player can grow. The pill adds Go there. Close and Open in panel (which opens the Agents panel) both record a dismissal, so the host does not float the agent again right away. `shouldRenderPreviewMiniPlayer` always shows this kind, because no panel shows the agent's window.
- `DesktopAgentMiniPlayerHost` (app root) opens and closes these sources through `usePreviewMiniPlayerStore`. It never replaces a floating browser tab or device, only opens a new view when "auto-show floating preview" is on, and closes only views that still show the same agent. `desktopAgentMiniPlayerStore` now holds only the suppression map (`dismissedByAgentId`). The host forgets a dismissal once the agent changes state or leaves. The fork kept it forever, so an agent returning to a state the user once dismissed stayed hidden. `resolveDesktopAgentMiniPlayerTargets` picks one agent per thread.
- `HyprnavVideoView` / `useHyprnavFrames` decode AV1, H.264 (Annex-B, no description) or VP9 with WebCodecs into a canvas. They rebuild the decoder on mid-stream CONFIG, drop deltas before the first keyframe, ignore keepalives, read records big-endian, ignore the AV1 CONFIG description, and fall back to an `<img>` multipart JPEG. Beyond the fork, a codec that fails to configure or decode is left out of the next request, so the daemon eventually picks JPEG. Once JPEG is chosen, video negotiation stops instead of reconnecting next to the image, and the `<img>` retries on error with backoff. The player asks for twice its CSS width rounded to a capture tier, with `follow=transient`, and reports decoded frame sizes back for the aspect ratio. Dev builds overlay codec, frame rate and frame age.

## Validation Coverage

- Server: frames content-type sniffing and request-line negotiation (`hyprnavFrames.test.ts`). In `hyprnavRoutes.test.ts`: 404 on a non-loopback host for every route, frames 404 for a window no agent names without touching the daemon socket, streaming an attached window from a fake frames socket with a filtered codec list, rejection of non-JSON posts, and the loopback check against spoofed Host headers, tailnet names and cross-site origins.
- Desktop: the display-media handler denies unarmed requests, answers exactly one armed request, and expires the arm (`HyprnavScreencast.test.ts`). Existing preview manager recording tests pass unchanged.
- Web: dismissals forgotten after a state change (`staleDesktopAgentDismissals`), frame record parsing (big-endian, CONFIG, keyframe detection), codec probing and playback mode, the show/hide rule including idle agents, dismissal suppression and one-agent-per-thread targets (`desktopAgentMiniPlayerStore.test.ts`), desktop-agent sources in `previewMiniPlayerStore.test.ts` (thread scope, position across a retarget, stale drags, width across agents), `shouldRenderPreviewMiniPlayer`, and the source size helper.
