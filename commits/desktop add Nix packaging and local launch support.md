# desktop add Nix packaging and local launch support

## Goal

Provide reproducible Linux desktop packaging, a current pnpm development shell, Home Manager integration, and a predictable mutable-checkout launcher without reviving the previous Bun/Turbo build layout.

## Included Changes

- Adds a pinned Nix flake for x86_64 and aarch64 Linux with desktop, dependency-cache, development-shell, formatter, and check outputs.
- Packages pnpm 11.10.0 to match the repository's declared package manager and consumes the committed pnpm lockfile through the Nixpkgs pnpm dependency hook.
- Builds the current Vite+ web, server, and Electron bundles and launches them with the matching Nixpkgs Electron 41 runtime.
- Adds a Home Manager module for packaged and mutable-checkout launchers.
- Adds validated Linux Ozone argument handling for local Wayland, X11, and automatic modes.
- Aligns packaged and mutable-checkout desktop identities so `t3code://` callbacks reopen the intended application.
- Registers the installed Nix launcher, rather than bare Electron, as the packaged `t3code://` handler.
- Patches the mutable checkout's bundled Claude executable for the pinned Nix runtime before launch.
- Uses the NixOS Chromium sandbox wrapper when available, otherwise probes Chromium's user-namespace sandbox, and only disables sandboxing when the host permits neither; `T3CODE_DESKTOP_DISABLE_SANDBOX=1` remains an explicit override.
- Keeps automatic updates disabled for the immutable Nix package.

## Expected Behavior

The desktop app can be built and installed from the flake, while a Home Manager local launcher can enter the same pinned development shell, build a checkout whose path may contain spaces, and start Electron with the intended display environment.

## Reimplementation Sources

This intent reimplements source commit `4a344903ed` and folds in sandbox and launch follow-ups `e4fcb5717c`, `23b4c5fc5e`, and `b3fe538052`. Capture commits `5653269749` and `c81f577a4a` supply the final sandbox selection, smoke cleanup/retry, and launch-environment behavior. Upstream's current macOS launcher identity and preload implementation remain canonical.

## Validation Coverage

Preserve the launcher, runtime-argument, app-identity, desktop-environment, Electron-app, sandbox-selection, launch-environment, local-wrapper, terminal-environment, and desktop smoke scenarios from the source stack.

## September modernization

Keep upstream's startup browser-secret compilation and macOS icon behavior. The Nix runtime now follows Electron 43, with updated nixpkgs and libsecret development dependencies. Package the Linux browser-import helper inside the app and resolve it from that install. Launcher, identity, environment, and helper-path regressions pass. Refresh the dependency hash and perform the complete Nix build after the remaining commits establish the final lockfile and desktop resources.
