# desktop add Nix packaging and local launch support

## Goal

Provide reproducible Linux desktop packaging, a pinned pnpm development shell, Home Manager
integration, and a predictable mutable-checkout launcher on top of upstream's Vite+ build.

## Included Changes

- Adds a pinned Nix flake for x86_64 and aarch64 Linux with desktop, dependency-cache,
  development-shell, formatter, and check outputs.
- Packages pnpm 11.10.0 to match the declared package manager and consumes the committed lockfile
  through the Nixpkgs pnpm dependency hook. The Vite+ 0.3.3 Linux native binding is fetched
  separately, because the pnpm fixed-output derivation can drop that optional package.
- Builds the Vite+ web, server, and Electron bundles and launches them with Nixpkgs `electron_44`.
- Builds the pure-Rust `native/` helpers (Hyprland and KDE capture, resource monitor) with
  `rustPlatform.buildRustPackage`, and stages them with the browser-secret helper and the GNOME
  extension files under `<app>/resources` in the layout packaged builds expect.
- Adds a Home Manager module for packaged and mutable-checkout launchers.
- Adds validated Linux Ozone argument handling for local Wayland, X11, and automatic modes.
- Rebuilds the checkout's `node-pty` against the pinned Electron headers before launch, and
  restores the pre-Nix user environment for the app and its terminals.
- Uses the NixOS Chromium sandbox wrapper when available, otherwise probes Chromium's
  user-namespace sandbox, and only disables sandboxing when the host permits neither;
  `T3CODE_DESKTOP_DISABLE_SANDBOX=1` remains an explicit override.
- Keeps automatic updates disabled for the immutable Nix package.

## Launcher contract

The Nix wrapper and `scripts/run-local-desktop.sh` configure the app through environment variables:

- `T3CODE_DESKTOP_FORCE_PACKAGED=1` makes the shared Nixpkgs Electron behave as a packaged app.
- `T3CODE_DESKTOP_RESOURCES_PATH` replaces Electron's immutable `process.resourcesPath` for
  packaged resource lookups.
- `T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME` names a desktop entry the package manager installs.
  The app uses it for `setDesktopName` before ready (so Clerk's scheme registration and the portal
  see it) and for `xdg-mime default`, but never writes its hidden URL-handler entry over it. The
  Nix package installs `com.t3tools.T3Code.desktop`, upstream's default id; the local launcher
  installs `t3-code-alpha.desktop`.
- `T3CODE_DESKTOP_LINUX_URL_HANDLER_EXEC` is the `Exec` target whenever the app does write its
  handler entry.
- `T3CODE_DESKTOP_ELECTRON_PATH` makes the development launcher use the Nix Electron wrapper.

## Expected Behavior

The desktop app builds and installs from the flake. A Home Manager local launcher enters the same
pinned development shell, builds a checkout whose path may contain spaces, and starts Electron with
the intended display environment. `t3code://` callbacks reopen the launcher that registered them.

## Reimplementation Sources

Reimplements `25ddb486db` (itself folding `4a344903ed`, `e4fcb5717c`, `23b4c5fc5e`, `b3fe538052`,
`5653269749`, and `c81f577a4a`). Folds `aa0228fedc` (the local launcher no longer patches the bundled Claude executable), `84f93ad10f`
(dependency hash), and `4241308556` (Vite+ native binding). Drops `78e233d6ba`: the web package
typechecks without `isolatedModules` on the current toolchain.

## September 24 modernization

- Upstream moved `setDesktopName` into pre-ready startup and renamed the default desktop id, so the
  entry-name override now lives in `resolveEarlyLinuxElectronOptions` and `DesktopEnvironment`. The
  fork's re-registration of the protocol client in `DesktopAppIdentity` is gone: the override is
  applied before Clerk registers the scheme.
- Upstream now writes its hidden handler entry under the app's desktop id. Package-managed entries
  are skipped so the visible Nix or Home Manager launcher is not shadowed.
- The Linux browser-secret `appRoot` fallback is replaced by the resources-path override, which
  also covers the capture helpers, resource monitor, and GNOME extension.
- nixpkgs moved forward to provide `electron_44` (44.3.0; the npm package is 44.4.2, same ABI).
- The pnpm dependency hash is still the previous value. Recompute it and run the full Nix build
  once the remaining units settle the lockfile.

## Validation Coverage

Launcher, sandbox-selection, runtime-argument, launch-environment, and local-wrapper scripts; the
desktop entry override through pre-ready startup, the environment, and the URL handler; the
packaged-behavior and resources-path overrides; terminal environment restoration; and flake
evaluation.
