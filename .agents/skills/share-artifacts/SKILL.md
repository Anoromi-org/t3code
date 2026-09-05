---
name: share-artifacts
description: Publish and link user-facing artifacts through the private artifacts server. Use for demonstrating to the user any artifacts related to plans, videos, video demonstrations, or images, including MP4 files and self-contained HTML/CSS/JavaScript presentations.
---

# Share Artifacts

Use this skill for demonstrating to the user any artifacts related to plans, videos, video demonstrations, or images.

Store every artifact under:

`/home/anoromi/Artifacts`

Use these exact layouts:

- MP4: `/home/anoromi/Artifacts/<artifact-name>.mp4`
- Image: `/home/anoromi/Artifacts/<artifact-name>.<extension>`
- HTML: `/home/anoromi/Artifacts/<artifact-name>/index.html`
- HTML JavaScript: `/home/anoromi/Artifacts/<artifact-name>/script.js`
- HTML CSS: `/home/anoromi/Artifacts/<artifact-name>/styles.css`

Read the artifacts origin from:

`~/.agents/urls/artifacts.txt`

Require one absolute `https://` URL with no path or trailing slash. If the file is missing or
invalid, stop and tell the user to run `scripts/setup-t3code-cloudflare-tunnel sync-urls` from the
T3 Code repository. Never guess or hardcode the origin.

Append `/<relative-path>` to that origin and paste the final URL as a clickable Markdown link.

Map `<relative-path>` directly from the path beneath `/home/anoromi/Artifacts`. For example:

- `/home/anoromi/Artifacts/demo.mp4` → `<artifacts-origin>/demo.mp4`
- `/home/anoromi/Artifacts/plan/index.html` → `<artifacts-origin>/plan/`

Use URL-safe artifact names. Verify that the artifact exists before pasting the link. When checking the public origin without credentials, treat HTTP `401 Unauthorized` as confirmation that the protected artifacts server is reachable. Do not ask for, log, or include authentication credentials in the URL.
