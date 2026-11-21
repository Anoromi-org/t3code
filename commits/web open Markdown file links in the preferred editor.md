# web open Markdown file links in the preferred editor

## Goal

A plain click on a file link in chat opens it in the preferred editor, where upstream opens the
file preview and needs Mod-click for the editor.

## Included Changes

- Upstream's `chat/MarkdownFileLink` takes `preferEditorOnClick`, set when a code editor (not the
  file manager) is preferred and the link is not an app bundle. A plain click then opens the editor. Media previews (PDFs, images, video) and
  folders keep their in-app primary action, and Mod-click keeps upstream's behavior.
- Bare filenames resolve through the workspace index before the editor opens. Upstream now does
  this for every file link, so the fork keeps only the test.
- The context menu gains "Open in file preview" (translated) so the preview stays one step away.

## Validation Coverage

`ChatMarkdown.fileLinks.browser.test.tsx`: editor on primary click, bare-filename resolution,
the files panel when no code editor is available, PDFs and folders kept out of the editor, the
context menu entries, and file preview and path copying from the menu. Upstream copies paths
relative to the workspace and through `navigator.clipboard.write`, so the copy case expects
`src/index.ts:12` and stubs `ClipboardItem` away to read `writeText`.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `59ca8fbb79` (previously onto `13aa882c22`
from `cc29337623`).
