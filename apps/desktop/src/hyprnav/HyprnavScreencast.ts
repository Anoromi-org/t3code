// @effect-diagnostics globalDate:off -- Electron calls the display-media handler synchronously, outside the Effect runtime.
/**
 * Display-media handling for the main window: lets the renderer's
 * `getDisplayMedia()` reach the system screen-share portal, but only right
 * after the desktop-agent Watch action asked for it.
 *
 * On Hyprland the portal (xdg-desktop-portal-hyprland) asks its picker which
 * source to share. hyprnav's picker answers from a request file written by
 * `hyprnav screencast request <address>` (see `requestHyprnavScreencast`), so
 * no dialog appears and the returned source is exactly the agent's window.
 * That IPC call also arms one portal request here; any other display-media
 * request is denied, as it was before, so a page cannot open a share on its own.
 */
import * as Electron from "electron";

/** Matches how long hyprnav's picker honours a pre-answer. */
const ARM_VALIDITY_MS = 15_000;

let armedUntil = 0;

/** Lets the next main-window `getDisplayMedia()` reach the portal. */
export function armHyprnavDisplayMedia(now: number): void {
  armedUntil = now + ARM_VALIDITY_MS;
}

/** Answers from the portal when armed (and consumes the arm), denies otherwise. */
export function handleHyprnavDisplayMediaRequest(
  _request: Electron.DisplayMediaRequestHandlerHandlerRequest,
  callback: (streams: Electron.Streams) => void,
  now: number = Date.now(),
): void {
  const armed = now <= armedUntil;
  armedUntil = 0;
  if (!armed) {
    callback({});
    return;
  }
  Electron.desktopCapturer
    .getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } })
    .then((sources) => {
      const source = sources[0];
      if (!source) {
        callback({});
        return;
      }
      callback({ video: source });
    })
    .catch(() => callback({}));
}

export function installHyprnavDisplayMediaHandler(
  window: Electron.BrowserWindow,
  platform: NodeJS.Platform,
): void {
  if (platform !== "linux") return;
  window.webContents.session.setDisplayMediaRequestHandler(
    (request, callback) => handleHyprnavDisplayMediaRequest(request, callback),
    { useSystemPicker: false },
  );
}
