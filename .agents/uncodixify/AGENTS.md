# Uncodixify

Use this skill for UI work.

If you are a Codex agent and the task touches UI, visual styling, layout, components, design tokens, or frontend presentation, you must apply this file before making design decisions.

## Goal

Avoid default AI-dashboard styling. Build interfaces that feel product-led, restrained, and human-designed.

The baseline is simple: normal app structure, clear hierarchy, predictable spacing, modest radii, subtle motion, and visual choices that serve the product instead of drawing attention to themselves.

## Default Posture

- Reuse the project's existing UI patterns before inventing new ones.
- Match established product structure when it exists.
- Prefer straightforward headers, sections, navigation, and content areas.
- Keep layout readable and functional under real usage, not just in screenshots.
- Follow existing component or Figma patterns closely when they are available.

## Hard Rules

- No hero sections inside application surfaces unless there is a product reason.
- No glassmorphism, frosted panels, blur haze, or floating-shell layouts by default.
- No soft gradients or blue-purple AI aesthetics unless the product already uses them.
- No oversized rounded corners. Typical radii should stay around `8px` to `12px`.
- No pill-shaped everything. Buttons, tabs, badges, and panels should not all share the same soft capsule treatment.
- No decorative eyebrow labels, uppercase micro-headings, or pseudo-marketing copy in product UI.
- No fake charts, fake metrics, or filler activity panels used only to occupy space.
- No dramatic shadows, glow effects, or detached cards trying to look "premium."
- No hover transforms or bouncy motion for routine interactions.
- No invented asymmetry, dead space, or ornamental wrappers added just to create visual drama.
- No generic AI-dashboard composition with a branded left rail, KPI row, and decorative right rail unless the product genuinely needs it.

## Component Guidance

- Sidebars: fixed, simple, functional, with a normal width and a clear border or surface change.
- Headers: plain text hierarchy only. Use `h1`/`h2` scale appropriately and skip decorative framing.
- Sections: standard spacing, direct labels, and no extra explanatory fluff.
- Buttons: solid fill or simple outline, restrained radius, no gradient backgrounds.
- Cards and panels: subtle borders, restrained shadow, no floating effect.
- Forms: labels above fields, clear focus states, no floating labels or novelty interactions.
- Inputs: solid borders or existing project styling, no animated underlines or morphing states.
- Tables and lists: left-aligned, readable, functional density, no badge spam.
- Tabs and navigation: simple active state, subtle hover, no pill slider treatment.
- Modals and dropdowns: centered, direct, and lightly animated at most.

## Typography

- Prefer the project's existing font choices.
- If the project does not define them, use a simple sans-serif with a clear hierarchy.
- Do not mix serif headlines with system sans as a shortcut to "premium."
- Avoid defaulting to `Arial`, `Roboto`, `Inter`, or similar safe stacks unless the product already uses them.

## Color Policy

1. Use the project's existing colors first.
2. If the project has no clear palette, derive from nearby product surfaces or brand assets.
3. Only invent a fresh palette when the user explicitly asks for one.

Colors should stay calm, readable, and subordinate to information hierarchy.

## Codex Self-Check

Before finishing UI work, remove anything that feels like a default Codex move:

- decorative gradients
- oversized radii
- floating glass cards
- fake dashboard content
- eyebrow labels
- ornamental copy
- transform-heavy hover states
- visual patterns repeated everywhere without product meaning

If a choice looks easy because it matches the usual AI-generated UI pattern, stop and pick the cleaner, more ordinary option instead.
