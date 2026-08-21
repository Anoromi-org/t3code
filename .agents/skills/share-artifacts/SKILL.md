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

Use this link template for showing a file to the user:

`https://artifacts-4afcfbd4411e55ac20ad6860ca087a32.anoromi.com/<relative-path>`

Paste the final URL as a clickable Markdown link.

Map `<relative-path>` directly from the path beneath `/home/anoromi/Artifacts`. For example:

- `/home/anoromi/Artifacts/demo.mp4` → `https://artifacts-4afcfbd4411e55ac20ad6860ca087a32.anoromi.com/demo.mp4`
- `/home/anoromi/Artifacts/plan/index.html` → `https://artifacts-4afcfbd4411e55ac20ad6860ca087a32.anoromi.com/plan/`

Use URL-safe artifact names. Verify that the artifact exists before pasting the link. When checking the public origin without credentials, treat HTTP `401 Unauthorized` as confirmation that the protected artifacts server is reachable. Do not ask for, log, or include authentication credentials in the URL.
