# Web open Markdown file links in the preferred editor

Clicking a Markdown file link opens the file in the preferred editor when the environment allows
shell actions. The context menu gains "Open in file preview" and keeps the relative and full path
copy actions.

## Reimplementation Sources

This reimplements fork commit `460a1b8bf7` on upstream `e4eb9977f0`.

- Upstream's in-app primary actions still come first. A PDF (or a browser file with no editor or
  panel) opens in the integrated browser, media opens its preview, and a folder link (trailing
  separator) opens the files panel on its tree. Every other file goes to the editor. Without shell
  actions (remote open mode) or without a code editor (none installed, or only the file manager)
  the click falls back to the files panel as before. Upstream's `Mod`-click still forces the
  editor for any file.
- A bare filename such as `ChatView.tsx#L12` is resolved through the workspace index before the
  editor opens, the same lookup the files panel uses, keeping the line and column. This also fixes
  the context menu's editor entry.
- "Open in file preview" appears only when the link has a thread and a panel path.
- External web links keep upstream's context menu, including Copy Link.

## Validation Coverage

A Chromium test renders `ChatMarkdown` with real Markdown. It covers editor primary activation,
bare filename resolution before the editor opens, the files panel fallback without an editor,
PDF clicks staying in the integrated browser, folder clicks opening the files panel, the context
menu order with the integrated browser and file preview entries, file preview with a reveal line,
and relative and full path copies. `MarkdownFileLink` stays private.
