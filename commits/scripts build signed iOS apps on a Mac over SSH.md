# Scripts: build signed iOS apps on a Mac over SSH

## Goal

Build the signed preview (or any EAS profile) from a Linux checkout on a Mac reachable over SSH, using EAS-managed credentials but no EAS cloud build quota: `scripts/build-ios-on-mac.sh --host user@mac [--profile preview] [--upload]`.

## Behavior

- Syncs the working tree with rsync, keeping the Mac's `node_modules` and generated native projects (a plain `--delete` sync with only the gitignore filter wiped them).
- Commits a throwaway snapshot repository on the Mac because `eas build --local` archives through git. Build state lives in `~/.cache/t3code-ios-build`, outside the checkout, so it never lands in the archive.
- Runs `eas build --local` as a launchd job in the logged-in desktop session (`gui/<uid>`). In an SSH session macOS does not search user keychains, so Xcode reports "No signing certificate iOS Distribution found" even after EAS imports the identity.
- Copies the `.ipa` to `apps/mobile/build/`; `--upload` runs `eas upload` for an expo.dev install link.
- `--remote-env` (or `T3_IOS_BUILD_ENV`) prefixes Mac commands that need Node 24 and pnpm.

## Mac prerequisites

Xcode, CocoaPods, Fastlane, Node 24 with corepack, `eas login`, a desktop login, and Apple's WWDR G3 intermediate in the System keychain (without it the distribution identity is not valid).
