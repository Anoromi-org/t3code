# Nix desktop installation

The fork's flake builds `desktop` for x86-64/ARM64 Linux and Apple Silicon macOS.
Run `nix build .#desktop` in a checkout, then `./result/bin/t3-code`.
macOS uses the upstream Electron binary; Linux retains its sandbox wrapper
and desktop capture helpers. The macOS package includes node-pty's spawn helper.

For a separate installation config, create a flake outside the checkout and
pin this fork as an input. Install its desktop package with `nix profile install`.
Keep the lock file so upgrades are explicit and previous profile generations
remain available for rollback. Codex and Claude Code can be included in the
same profile, but each requires its own sign-in on the host.

The package disables T3 Code's built-in updater. Update the pinned fork input
and run `nix profile upgrade` instead. An already running desktop keeps its
current version until restarted.

The optional Home Manager mutable-checkout launcher currently requires Linux.
Use the packaged `t3-code` command on macOS.
