/**
 * Display-media handler for the main window: lets the renderer's
 * `getDisplayMedia()` reach the system screen-share portal.
 *
 * On Hyprland the portal (xdg-desktop-portal-hyprland) asks its picker which
 * source to share. hyprnav's picker answers from a request file written by
 * `hyprnav screencast request <address>` (see `requestHyprnavScreencast`), so
 * no dialog appears and the returned source is exactly the agent's window.
 * Anywhere else the stock picker shows, which is the normal behaviour.
 */
import * as Electron from "electron";

export function handleHyprnavDisplayMediaRequest(
  _request: Electron.DisplayMediaRequestHandlerHandlerRequest,
  callback: (streams: Electron.Streams) => void,
): void {
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
