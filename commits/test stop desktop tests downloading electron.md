# Test: stop desktop tests downloading Electron

## Goal

`apps/desktop` tests that import modules touching `electron` load the npm `electron` package, whose `index.js` runs `install.js` (a ~100 MB GitHub download) whenever `node_modules/electron/dist` is missing. Since electron 44 that installer no longer honours `ELECTRON_SKIP_BINARY_DOWNLOAD` (which the Nix dev shell sets), and nothing coordinates parallel workers. A full `vp test run` in a checkout without the binary therefore started one download per worker (16 at once on 2026-10-18), saturating the network.

## Change

`apps/desktop/vite.config.ts` sets `test.env.ELECTRON_OVERRIDE_DIST_PATH` (unless already set) to the directory of `T3CODE_DESKTOP_ELECTRON_PATH` (the Nix Electron from the dev shell) or a placeholder. The package's `getElectronPath()` returns early for that variable, before any download. The tests only need the path string; none launch the binary.

## Notes

- Verified with `dist/`, `path.txt` and `~/.cache/electron` moved aside: without the change, the three files that triggered it (`src/ipc/methods/localEnvironment.test.ts`, `src/backend/DesktopLocalEnvironmentAuth.test.ts`, `src/app/DesktopAppActivation.test.ts`) reinstall Electron. With it, nothing is downloaded and they pass.
- `@electron/get` ignores `HTTPS_PROXY` unless `ELECTRON_GET_USE_PROXY` is set, so a dead proxy does not block it.
- The app itself still runs on the Nix Electron via `T3CODE_DESKTOP_ELECTRON_PATH`; `pnpm ensure:electron` remains the way to install the npm binary on purpose.
