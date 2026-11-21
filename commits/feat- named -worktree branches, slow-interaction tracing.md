# feat: named /worktree branches, slow-interaction tracing

## Goal

Name a new worktree's branch from the composer and find threads by their worktree folder.

## Included Changes

- Named worktrees: `/worktree <branch>` in the composer names the branch of the new worktree
  through upstream's `prepareWorktree.branch`. The plain `/worktree` still opens upstream's
  workspace picker. The branch toolbar, environment-mode selector, and thread details show
  "New worktree on {branch}". Changing the environment mode clears the name. Sending to several
  models keeps one auto-named worktree per model.
- Thread search: upstream's shared thread search subject gains the worktree folder name (not its
  parent path), so the command palette, the Mod+E menu, the sidebar, and mobile all match it. The
  Mod+E menu ranks with upstream's thread search scoring and appends server message-text matches.
- Slow-interaction tracing landed with the observability unit.
- All new copy is translated in every web locale.

## Validation Coverage

The named `/worktree` trigger cases in `composer-logic.test.ts` and
`NavigationCommandMenu.logic.test.ts` (subagents excluded, split words, worktree folder, message
content).

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `b5071e4393`. The fork's command palette
search changes are replaced by the shared thread search subject. The fork commit's realtime voice
calls (`voice.start`/`voice.stop`, Codex-delegating voice sessions) were dropped at the owner's
request; upstream dictation is unaffected.
