# Product

## Register

product

## Users

T3 Code is for solo developers who use coding agents as part of their day-to-day programming workflow. They are usually working inside a real repository, juggling agent turns, diffs, terminals, branches, worktrees, settings, and provider state while trying to keep momentum.

The primary user is comfortable with developer tools and expects keyboard control to be more than a shortcut layer. Keyboard-first should feel natural to a Neovim user: fast, composable, predictable, and available across the important workflows without trapping them in a mouse-shaped interface.

## Product Purpose

T3 Code is a simple IDE-like workspace for managing coding agents without extra fluff. It gives developers a clear place to start, monitor, resume, interrupt, inspect, and recover agent work across Codex, Claude, terminals, diffs, and project context.

Success means the developer can understand what the agent is doing, act at the right moment, recover from runtime or connection failures, and move between threads or worktrees without losing context. The interface should make complex agent orchestration feel controllable rather than decorative.

## Brand Personality

Capable.

The product voice should be direct, quiet, and precise. It should feel like a serious local development tool: confident enough to stay out of the way, explicit when state matters, and unwilling to hide operational detail behind vague AI gloss.

## Anti-references

Do not make T3 Code feel like a generic SaaS dashboard, a chat toy, a flashy AI wrapper, or an IDE clone bloated with panels that do not serve the active workflow.

Avoid marketing-heavy surfaces inside the app, decorative feature explanations, noisy onboarding, overproduced assistant personalities, and UI chrome that competes with code, diffs, terminal output, or current agent state.

## Design Principles

1. Put the working state first. The user should always be able to see the active thread, provider state, pending decisions, runtime failures, and relevant diffs without hunting.

2. Make keyboard control structural. Commands, navigation, thread actions, terminal focus, and diff workflows should be reachable in a way that feels intentional to power users, not bolted on after mouse interactions.

3. Prefer operational clarity over charm. Empty states, errors, loading, reconnecting, and partial streams should describe what happened and what the user can do next.

4. Keep the interface dense but calm. The product can expose serious capability, but every surface should earn its space and avoid visual noise that slows repeated use.

5. Respect local developer context. Projects, branches, worktrees, terminals, and external tools are part of the workspace, not secondary integrations.

## Accessibility & Inclusion

T3 Code should be keyboard-first with reliable focus behavior, visible focus states, readable contrast, and reduced-motion support for nonessential animation.

No formal WCAG level is currently required beyond doing the fundamentals well. Accessibility work should prioritize predictable keyboard traversal, screen-reader legibility for stateful controls, and avoiding color-only status communication.
