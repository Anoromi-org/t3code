# fix(nix): refresh desktop package for modernized dependencies

## Goal

Keep `nix build .#desktop` working after the modernization changed the lockfile and upstream
added build-time license generation.

## Included Changes

- Refreshes the pnpm dependency hash for the modernized `pnpm-lock.yaml` (Effect rc.115,
  TypeScript 7, the `packages/sdk` importer).
- Seeds the SPDX license cache that upstream's `t3code:third-party-licenses` Vite plugin reads
  before it downloads license texts. The sandbox has no network, so the web build failed with
  `getaddrinfo EAI_AGAIN raw.githubusercontent.com`. Nix now fetches SPDX `json/details` at the
  revision pinned in `scripts/lib/third-party-licenses.ts` and copies it to
  `.generated/third-party-licenses/spdx/<version>/`. The version and revision are read from that
  script, so a revision bump fails loudly on the fetch hash instead of silently going online.

## Verification

- `nix build .#desktop` succeeds. The output has the packaged server, preload bundles, the
  Ghostty worktree entry, the browser-secret, Hyprland/KDE capture, and resource-monitor helpers
  (no missing shared libraries), the icon, and `com.t3tools.T3Code.desktop`.
- A headless launch of the built app under Xvfb with an isolated home reached `backend ready`,
  with no fatal module or renderer errors.
