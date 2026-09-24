# Web add project actions panel

Add a project-scoped `Mod+P` panel for the current thread's project actions, source-control
steps, and supported Open In targets. It is a modal command surface
(`data-command-surface="project-actions"`): it does not stack over the command palette or
navigation menu, its own toggle closes it, and every other resolved shortcut (including
`mod+[` back and `mod+z` thread undo) is swallowed while it is open. Text editing inside its
search field stays native. Git actions route into the header's `GitActionsControl` through a
one-shot request, so dialogs, toasts, pull, publish, and init reuse the existing flows. The
file picker moves to `Mod+Shift+P` and thread pinning to `Mod+Alt+Shift+P`; on startup the
server renames legacy `commandBar.toggle` rules to `projectActions.toggle` and moves only the
exact generated `mod+p` file-picker and `mod+shift+p` pin rules, and only in a file that has
no project-actions rule yet and onto a shortcut no other rule holds, so custom bindings and
later choices are left alone.

Saving a project action's shortcut now makes it the only binding for that action: the
keybinding API gains `replaceAllForCommand` on upsert and `{ command, all: true }` on remove.
Clearing a shortcut removes every rule for the action, and a failed shortcut write rolls the
action list back. This applies to the chat header editor and to project settings. Deleting an
action keeps its shortcut while the environment defaults or another project still use that action id.

## Reimplementation Sources

Reimplements fork commit `ff68ecc6e9` against upstream `e4eb9977f0`. Upstream moved project
scripts into environment settings (`projectSettingsOverrides`) and settings-page editing into
`settings/useProjectScriptSettings.ts`; the fork's `persistProjectScriptsAndKeybinding`
behavior now lives there, keeping upstream's multi-environment fan-out and the rule that a
shortcut still used by another project's action is not removed. Rollback restores the previous
override entry rather than writing the resolved list. The panel reuses upstream
`resolveOpenInOptions` with the header picker's editor list and remote-open modes, `ScriptIcon`, and `PullRequestGlyph`; its dialog
and search input follow `NavigationCommandMenu` without restyling `ui/*` components. Status
queries and row building run only while the panel is open. The frozen legacy keybinding
snapshot and command-surface guards came with "restore Hyprnav settings and shortcut contracts".
Remote servers without `replaceAllForCommand` ignore it and append the new rule, and reject
remove-all, so shortcut edits against them keep the old binding or fail and roll back.

## Validation Coverage

Unit tests cover action descriptors across repository states, loading and error rows, alias
search and group order, modal shortcut disposition, the new defaults and labels, legacy
command-bar and moved-default migration (file picker and pin), remove-all and replace-all
keybinding writes, and shortcut mutation and rollback helpers. Chromium coverage verifies
`Mod+P` focus, search and single execution, Git request routing, editor launching, Escape focus
restoration, command-surface mutual exclusion, blocked global shortcuts, `mod+[` and `mod+z`
staying behind the open panel while `mod+z` still undoes text in its search field, and clearing
a shortcut in the action editor.
