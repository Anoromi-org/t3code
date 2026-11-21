// @effect-diagnostics globalDate:off -- Electron calls the display-media handler synchronously, outside the Effect runtime.
/**
 * Only a display-media request right after the Watch action reaches the
 * portal, which hyprnav's picker pre-answers with the agent's window. Any
 * other request is denied, so a page cannot open a share on its own.
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

/**
 * Sessions whose display-media handler is already installed. The preview manager adds the main
 * window's session when it installs its recording handler, which already defers to this one.
 */
export const displayMediaHandlerSessions = new WeakSet<Electron.Session>();

/** Installs the handler on a session that has none yet; called when a Watch arms it. */
export function installHyprnavDisplayMediaHandler(session: Electron.Session): void {
  if (displayMediaHandlerSessions.has(session)) return;
  displayMediaHandlerSessions.add(session);
  session.setDisplayMediaRequestHandler(
    (request, callback) => handleHyprnavDisplayMediaRequest(request, callback),
    { useSystemPicker: false },
  );
}
