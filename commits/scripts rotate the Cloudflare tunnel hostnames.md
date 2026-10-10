# Scripts: rotate the Cloudflare tunnel hostnames

## Goal

`setup-t3code-cloudflare-tunnel` could rotate the artifacts password but not the public hostnames, so a leaked T3, artifacts, or interactions URL stayed valid until the tunnel was rebuilt.

## Behavior

`setup-t3code-cloudflare-tunnel rotate-hostnames` moves all three services to a fresh random suffix on the same tunnel. It routes DNS for the new names, rewrites the ingress config with the T3 port that setup chose (read back from the existing config), records the new T3 hostname, restarts the user service, and refreshes the agent URL files. The old hostnames no longer match an ingress rule and fall through to the 404 rule.

## Notes

Reapplied from an uncommitted change on another machine, adapted to the interactions hostname and agent URL files added since. The old DNS records are left in place; they point at the tunnel but serve 404.
