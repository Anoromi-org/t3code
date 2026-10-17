# web restore keyboard composer actions

## Goal

Keep keyboard-only `/branch`, `/worktree`, and `/reasoning` composer actions so the run context
can change without leaving the composer.

## Included Changes

- Built-in slash commands `/branch`, `/worktree`, and `/reasoning` sit next to upstream's
  `/model`. Choosing one removes the typed command and opens upstream's own picker, the same way
  its keyboard shortcut does: the branch picker (`onOpenBranchPicker`, from ChatView's branch
  toolbar), the workspace picker (`composer.workspace`, including "New worktree"), and the
  reasoning effort control (`composer.effort`). `/branch` only appears where a branch toolbar
  exists.
- The composer's `openControl` handle body is a local `composerHandleOpenControl` so slash
  commands and shortcuts share it.

## Superseded

The fork's inline branch/ref submenu (debounced paginated ref search, named `/worktree <name>`
with a separately stored `worktreeBranchName`, live reasoning option rows) is dropped. Upstream
now ships keyboard-reachable branch, workspace, and effort pickers with search, and names new
worktree branches from the first message on the server, so the fork reaches those pickers
instead of maintaining a parallel implementation.

## Validation Coverage

Typecheck and the composer unit suites. Selecting each command is part of the integrated client
pass.

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `78812e6dc9` (itself from `4c6227a910`).
