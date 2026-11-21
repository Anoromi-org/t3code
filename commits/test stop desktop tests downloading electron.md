# Test: stop desktop tests downloading Electron

## Goal

`apps/desktop` tests that import modules touching `electron` load the npm `electron` package, whose `index.js` runs `install.js` (a ~100 MB GitHub download) whenever `node_modules/electron/dist` is missing. Since electron 44 that installer ignores `ELECTRON_SKIP_BINARY_DOWNLOAD` (which the Nix dev shell sets). The fork's own runtime is the Nix Electron, so the download is wasted.

## Change

Upstream now installs the binary once in a Vitest `globalSetup` (`scripts/ensure-electron-runtime.mjs`) so workers no longer race. That setup still downloads it. With this change:

- `setup()` returns early when `ELECTRON_OVERRIDE_DIST_PATH` or `T3CODE_DESKTOP_ELECTRON_PATH` is set.
- `apps/desktop/vite.config.ts` passes `ELECTRON_OVERRIDE_DIST_PATH` to the workers (taken as is, or as the directory of `T3CODE_DESKTOP_ELECTRON_PATH`), so the package's `getElectronPath()` returns before its lazy install. Without either variable the upstream install-once path runs unchanged; the fork's placeholder fallback is no longer needed.

## Notes

- Verified with `dist/` and `path.txt` moved aside and `T3CODE_DESKTOP_ELECTRON_PATH=/nonexistent/bin/electron`: `src/ipc/methods/localEnvironment.test.ts`, `src/backend/DesktopLocalEnvironmentAuth.test.ts` and `src/app/DesktopAppActivation.test.ts` pass and nothing is downloaded.
- `pnpm ensure:electron` still installs the npm binary on purpose.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `0f3a835997d`. Upstream's `globalSetup` replaced the fork's need for a placeholder; the fork intent survives as the override skip.
