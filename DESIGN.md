---
name: T3 Code
description: A capable, keyboard-first IDE workspace for managing coding agents.
colors:
  background: "var(--background)"
  foreground: "var(--foreground)"
  card: "var(--card)"
  card-foreground: "var(--card-foreground)"
  popover: "var(--popover)"
  popover-foreground: "var(--popover-foreground)"
  primary: "oklch(0.488 0.217 264)"
  primary-dark: "oklch(0.588 0.217 264)"
  primary-foreground: "var(--primary-foreground)"
  secondary: "var(--secondary)"
  secondary-foreground: "var(--secondary-foreground)"
  muted: "var(--muted)"
  muted-foreground: "var(--muted-foreground)"
  accent: "var(--accent)"
  accent-foreground: "var(--accent-foreground)"
  border: "var(--border)"
  input: "var(--input)"
  ring: "var(--ring)"
  destructive: "var(--destructive)"
  info: "var(--info)"
  success: "var(--success)"
  warning: "var(--warning)"
typography:
  title:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
  body:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "DM Sans, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0"
  mono:
    fontFamily: "SF Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0"
rounded:
  sm: "calc(var(--radius) - 4px)"
  md: "calc(var(--radius) - 2px)"
  lg: "var(--radius)"
  xl: "calc(var(--radius) + 4px)"
  2xl: "calc(var(--radius) + 8px)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 11px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 11px"
  input-default:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "30px"
    padding: "0 11px"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.2xl}"
---

# Design System: T3 Code

## 1. Overview

**Creative North Star: "The Agent Workbench"**

T3 Code should feel like a serious local development workbench for agent-driven programming. The system is compact, direct, and operational: it surfaces active work, failure states, thread context, diffs, terminals, provider status, and project controls without turning the app into a branded showcase.

The visual language is restrained product UI. It uses familiar desktop-app patterns, dense navigation, precise borders, small type, subtle tonal layers, and command-oriented surfaces. Personality comes from control and clarity, not decoration.

It rejects the exact anti-references in PRODUCT.md: generic SaaS dashboards, chat toys, flashy AI wrappers, IDE clones bloated with panels that do not serve the active workflow, marketing-heavy surfaces inside the app, decorative feature explanations, noisy onboarding, overproduced assistant personalities, and UI chrome that competes with code, diffs, terminal output, or current agent state.

**Key Characteristics:**

- Dense but calm layout, optimized for repeated use.
- Keyboard-native workflows with visible focus and command-menu affordances.
- Restrained blue accent for primary actions, selection, and focus.
- Tonal depth through borders, low-alpha fills, and one-pixel inner highlights.
- Operational copy that says what happened and what the user can do next.

## 2. Colors

The palette is a restrained developer-tool neutral system with a single capable blue accent and clear semantic status colors.

### Primary

- **Agent Blue** (`oklch(0.488 0.217 264)` light, `oklch(0.588 0.217 264)` dark): Used for primary actions, current selection, focus rings, and rare state emphasis. It should stay below 10% of any app screen.

### Neutral

- **Chrome Background** (`var(--app-chrome-background)`): The outer app substrate. It should frame the workspace without reading as a decorative backdrop.
- **Workspace Surface** (`var(--background)`): Main content surface for chat, settings, and panels.
- **Panel Surface** (`var(--card)` / `var(--popover)`): Cards, dialogs, menus, and controls. These are usually separated by border and tonal layer, not heavy shadow.
- **Working Text** (`var(--foreground)`): Primary text. Use it for commands, labels, message bodies, and current state.
- **Secondary Text** (`var(--muted-foreground)`): Metadata, timestamps, helper text, placeholder copy, and inactive state.
- **Hairline Structure** (`var(--border)` / `var(--input)`): Dividers, field borders, panel boundaries, sidebar separation.

### Secondary

- **Quiet Fill** (`var(--secondary)`): Low-alpha neutral fill for secondary buttons and contained state.
- **Hover Accent** (`var(--accent)`): Low-alpha neutral fill for hover, highlighted menu items, sidebar rows, and ghost controls.

### Tertiary

- **Status Red** (`var(--destructive)`): Destructive actions and error state.
- **Status Blue** (`var(--info)`): Informational state, distinct from primary action when needed.
- **Status Green** (`var(--success)`): Successful background tasks and healthy state.
- **Status Amber** (`var(--warning)`): Risk, pending attention, and degraded state.

### Named Rules

**The One Accent Rule.** Agent Blue is for primary action, focus, selection, and meaningful state. Do not use it as page decoration.

**The Chrome Stays Quiet Rule.** Sidebars, title areas, and panel edges can have tonal separation, but they should not compete with thread content, diffs, terminal output, or current agent state.

## 3. Typography

**Display Font:** DM Sans with system sans fallbacks.
**Body Font:** DM Sans with system sans fallbacks.
**Label/Mono Font:** SF Mono, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace.

**Character:** The type system is compact and interface-native. It favors legibility, scan speed, and steady rhythm over expressive display contrast.

### Hierarchy

- **Display** (600, 1.5rem to 1.875rem, 1.15): Reserved for rare empty states and route-level errors. Product screens should not rely on hero-scale type.
- **Headline** (600, 1.25rem, 1.15): Dialog titles, important settings sections, route-level panel headings.
- **Title** (600, 1.125rem, 1): Card titles and compact section headers.
- **Body** (400, 0.875rem, 1.5): Default text, chat prose, settings descriptions, and explanatory copy. Cap long prose at 65 to 75ch.
- **Label** (500, 0.75rem, 1.25): Metadata, control labels, menu annotations, thread status, timestamps, and compact UI.
- **Mono** (400, 0.75rem, 1.45): File paths, branches, command output labels, terminal-adjacent content, code, and keyboard-centric details.

### Named Rules

**The Product Scale Rule.** Use fixed rem sizes for app UI. Do not introduce fluid type inside product surfaces.

**The No Drama Labels Rule.** Labels, buttons, table text, and metadata stay in the sans stack. Display treatment belongs only to rare empty or error states.

## 4. Elevation

T3 Code uses tonal layering first and shadows second. Resting surfaces are mostly flat: border, background tint, and one-pixel inner highlight define depth. Shadows are subtle and structural, appearing on popovers, dialogs, menus, controls, and selected foreground surfaces.

### Shadow Vocabulary

- **Control Lift** (`shadow-xs/5` plus `before:shadow-[0_1px_--theme(--color-black/4%)]` in light mode): Default tactile treatment for buttons, inputs, cards, selects, popovers, and menus.
- **Dark Inner Highlight** (`before:shadow-[0_-1px_--theme(--color-white/6%)]`): Dark-mode equivalent of the one-pixel highlight, used to keep controls legible without bright borders.
- **Foreground Panel** (`shadow-lg/5`): Dialogs, menus, comboboxes, and command palettes that float above the main surface.
- **State Ring** (`ring-ring/24`, `focus-visible:ring-[3px]`, `focus-visible:ring-2`): Keyboard focus and validation affordance. Rings should be visible but not neon.
- **Worktree Settle Glow** (`0 12px 32px -20px color-mix(in srgb, var(--ring) 42%, transparent)`): Temporary state motion for newly born sidebar worktree groups only.

### Named Rules

**The Flat Until State Rule.** Resting UI should not look lifted for decoration. Increase depth only for focus, hover, foreground layers, or temporary operational state.

## 5. Components

Components should feel familiar, compact, and reliable. Every interactive component needs default, hover, focus, active, disabled, and loading or pending behavior where applicable.

### Buttons

- **Shape:** Rounded rectangle, usually `var(--radius-lg)` with inner highlight clipped to `calc(var(--radius-lg) - 1px)`.
- **Primary:** `bg-primary`, `text-primary-foreground`, `border-primary`, 32px desktop height, 36px base height, compact horizontal padding.
- **Hover / Focus:** Hover shifts primary to `bg-primary/90`. Focus uses a visible ring with offset. Disabled state uses `opacity-64` and removes pointer interaction.
- **Secondary / Ghost / Outline:** Secondary uses low-alpha neutral fills. Ghost uses transparent resting state and `bg-accent` on hover or pressed. Outline uses `border-input`, `bg-popover`, and subtle inner highlight.
- **Icon Buttons:** Square sizes from 24px to 40px. Prefer lucide icons, stable dimensions, and tooltips for unfamiliar controls.

### Chips

- **Style:** Compact badges use `rounded-sm`, small type, and status-specific low-alpha fills.
- **State:** Default badges can use primary only for active or important state. Error, info, success, and warning badges use semantic foreground with 8% to 16% fills.

### Cards / Containers

- **Corner Style:** `rounded-2xl` in the current library, with inner highlight clipped to `calc(var(--radius-2xl) - 1px)`.
- **Background:** `bg-card` or `bg-popover`, with `text-card-foreground` or `text-popover-foreground`.
- **Shadow Strategy:** Use tonal layering and one-pixel highlights. Avoid decorative nested cards.
- **Border:** `border` using `var(--border)` or Tailwind `border-border`.
- **Internal Padding:** Common panel rhythm is 16px to 24px. Dense rows use 8px to 12px.

### Inputs / Fields

- **Style:** `rounded-lg`, `border-input`, `bg-background`, compact heights around 30px to 34px, and inherited inner radius for the actual input.
- **Focus:** Border shifts to `border-ring`, with a 3px low-alpha ring. Invalid focus uses destructive border and ring.
- **Error / Disabled:** Invalid state uses destructive 36% to 64% borders and 16% to 24% rings. Disabled state uses opacity and removes interaction.

### Navigation

- **Style:** Sidebar and command surfaces use dense rows, icon plus label alignment, muted metadata, and active rows through `bg-sidebar-accent` or `bg-accent`.
- **Typography:** Text is usually 12px to 14px, medium for active labels, muted for secondary details.
- **States:** Hover and keyboard-highlight states must match. Command menus and navigation rows use the same accent fill vocabulary.
- **Mobile Treatment:** Product UI may collapse or sheet sidebars, but the keyboard command path should remain structurally available.

### Dialogs, Menus, and Command Surfaces

- **Style:** `bg-popover`, rounded large corners, subtle foreground shadow, and a backdrop only when modality is real.
- **Motion:** 75ms for command-menu scale and opacity transitions; 200ms for dialogs, collapsibles, and sheets.
- **Behavior:** Prefer inline or progressive controls before adding dialogs. Dialogs are for blocking confirmation, focused detail, or complex temporary workflows.

### Terminal and Diff Surfaces

- **Style:** Code, terminal output, diffs, branches, and paths should keep the mono stack or terminal-native rendering. Surrounding chrome should stay muted.
- **Behavior:** Do not visually bury terminal or diff surfaces inside decorative framing. These are primary working artifacts.

## 6. Do's and Don'ts

### Do:

- **Do** keep the interface dense but calm, with compact rows, stable control dimensions, and predictable panel structure.
- **Do** make keyboard focus visible on every command, menu item, field, sidebar row, terminal control, and diff action.
- **Do** use Agent Blue only for primary action, selection, focus, and meaningful state.
- **Do** use semantic red, blue, green, and amber for errors, info, success, and warning, with low-alpha fills for badges and panels.
- **Do** preserve operational clarity in empty, loading, reconnecting, interrupted, failed, and partially streamed states.
- **Do** prefer icons for compact tool actions, with labels or tooltips where the meaning is not obvious.
- **Do** keep motion short, state-driven, and respectful of reduced-motion preferences.

### Don't:

- **Don't** make T3 Code feel like a generic SaaS dashboard, a chat toy, a flashy AI wrapper, or an IDE clone bloated with panels that do not serve the active workflow.
- **Don't** add marketing-heavy surfaces inside the app, decorative feature explanations, noisy onboarding, overproduced assistant personalities, or UI chrome that competes with code, diffs, terminal output, or current agent state.
- **Don't** use gradient text, decorative glassmorphism, hero metrics, side-stripe borders, or repeated identical card grids.
- **Don't** use full-saturation accents on inactive state.
- **Don't** invent custom controls when Base UI, existing `components/ui`, or standard product affordances already solve the interaction.
- **Don't** hide critical provider, session, thread, terminal, or diff state behind hover-only affordances.
- **Don't** use em dashes in interface copy.
