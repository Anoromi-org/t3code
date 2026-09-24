# Add Cloudflare exposure setup

## Goal

Give the local T3 Code server, the private artifacts server, and the interaction platform stable public hostnames through a user-run Cloudflare tunnel, and let agents discover those origins without hardcoding them.

## Provenance

- Reapplies fork commit `d0db9502fe` (itself preserving `6e5dce06b2`).
- Also carries the tunnel URL synchronization changes to `scripts/setup-t3code-cloudflare-tunnel` and `.agents/skills/share-artifacts/SKILL.md` that the fork captured later in `49fa66dbed`, so the script and the skill that reads its output land together.

## Behavior

- `scripts/setup-t3code-cloudflare-tunnel [setup] [T3_PORT]` creates or reuses a named tunnel, routes `t3-<id>`, `artifacts-<id>`, and `interactions-<id>` hostnames, runs a password-protected Caddy container for `~/Artifacts`, and installs a user systemd unit for `cloudflared`. Config and unit files are only rewritten (and the service only restarted) when their content changes.
- `sync-urls` writes the three public origins to `~/.agents/urls/{t3-code,artifacts,interactions}.txt` atomically with mode 600. `rotate-artifacts-password` and `status` remain available.
- The `share-artifacts` skill reads the artifacts origin from `~/.agents/urls/artifacts.txt`, requires a bare `https://` origin, and tells the user to run `sync-urls` instead of guessing a hostname.

## Validation

- `bash -n scripts/setup-t3code-cloudflare-tunnel`. The script is a deployment tool; modernization does not run it or touch running tunnels or services.
