# web open Markdown file links in the preferred editor

## Goal

A plain click on a file link in chat opens it in the preferred editor, where upstream opens the
file preview and needs Mod-click for the editor.

## Included Changes

- `MarkdownFileLink` takes `preferEditorOnClick`, set when a code editor (not the file manager)
  is preferred. A plain click then opens the editor. Media previews (PDFs, images, video) and
  folders keep their in-app primary action, and Mod-click keeps upstream's behavior.
- Bare filenames resolve through the workspace index before the editor opens, like the files
  panel, so the nested file opens instead of `<cwd>/<name>`.
- The context menu gains "Open in file preview" so the preview stays one step away.

## Validation Coverage

`ChatMarkdown.fileLinks.browser.test.tsx`: editor on primary click, bare-filename resolution,
the files panel when no code editor is available, PDFs and folders kept out of the editor, the
context menu entries, and file preview and path copying from the menu.

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `cc29337623`.
