import "../index.css";

import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { useRightPanelStore } from "../rightPanelStore";

const { contextMenuShow } = vi.hoisted(() => ({ contextMenuShow: vi.fn() }));

vi.mock("../localApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../localApi")>()),
  readLocalApi: () => ({ contextMenu: { show: contextMenuShow } }),
}));

import { MarkdownFileLink } from "./ChatMarkdown";

const threadRef = {
  environmentId: "local",
  threadId: "thread-markdown-link",
} as ScopedThreadRef;

function openContextMenu() {
  const link = document.querySelector<HTMLAnchorElement>("a");
  if (!link) throw new Error("Markdown file link not found");
  link.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 20,
    }),
  );
}

describe("MarkdownFileLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
    useRightPanelStore.setState({ byThreadKey: {} });
    document.body.innerHTML = "";
  });

  it("opens code paths in the preferred editor on primary click", async () => {
    const openInEditor = vi.fn(async () => AsyncResult.success(undefined));
    const openInBrowser = vi.fn(async () => AsyncResult.success(undefined));
    const screen = await render(
      <MarkdownFileLink
        href="/workspace/project/src/index.ts"
        targetPath="/workspace/project/src/index.ts"
        iconPath="src/index.ts"
        displayPath="src/index.ts"
        panelPath="src/index.ts"
        label="index.ts"
        copyMarkdown="[index.ts](src/index.ts)"
        theme="dark"
        openInEditorMenuLabel="Open in editor"
        onOpenInPanel={(path, line) =>
          useRightPanelStore.getState().openFile(threadRef, path, line)
        }
        onOpen={openInEditor}
        onOpenInBrowser={openInBrowser}
      />,
    );

    try {
      await page.getByRole("link", { name: "index.ts" }).click();
      expect(openInEditor).toHaveBeenCalledOnce();
      expect(openInEditor).toHaveBeenCalledWith("/workspace/project/src/index.ts");
      expect(openInBrowser).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("routes the context menu to the integrated browser when available", async () => {
    const openInEditor = vi.fn(async () => AsyncResult.success(undefined));
    const openInBrowser = vi.fn(async () => AsyncResult.success(undefined));
    contextMenuShow.mockResolvedValueOnce("open-in-browser");
    const screen = await render(
      <MarkdownFileLink
        href="/workspace/project/index.html"
        targetPath="/workspace/project/index.html"
        iconPath="index.html"
        displayPath="index.html"
        panelPath="index.html"
        label="index.html"
        copyMarkdown="[index.html](index.html)"
        theme="dark"
        openInEditorMenuLabel="Open in editor"
        onOpenInPanel={(path, line) =>
          useRightPanelStore.getState().openFile(threadRef, path, line)
        }
        onOpen={openInEditor}
        onOpenInBrowser={openInBrowser}
      />,
    );

    try {
      openContextMenu();
      await vi.waitFor(() => expect(openInBrowser).toHaveBeenCalledOnce());
      expect(contextMenuShow.mock.calls[0]?.[0]).toEqual([
        { id: "open", label: "Open in editor" },
        { id: "open-in-browser", label: "Open in integrated browser" },
        { id: "copy-relative", label: "Copy relative path" },
        { id: "copy-full", label: "Copy full path" },
      ]);
      expect(openInEditor).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("opens file preview and copies relative and full paths from the context menu", async () => {
    const openInEditor = vi.fn(async () => AsyncResult.success(undefined));
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    contextMenuShow
      .mockResolvedValueOnce("open-in-preview")
      .mockResolvedValueOnce("copy-relative")
      .mockResolvedValueOnce("copy-full");
    const screen = await render(
      <MarkdownFileLink
        href="/workspace/project/src/index.ts:12"
        targetPath="/workspace/project/src/index.ts:12"
        iconPath="src/index.ts"
        displayPath="src/index.ts:12"
        panelPath="src/index.ts"
        line={12}
        label="index.ts"
        copyMarkdown="[index.ts](src/index.ts:12)"
        theme="dark"
        openInEditorMenuLabel="Open in editor"
        onOpenInPanel={(path, line) =>
          useRightPanelStore.getState().openFile(threadRef, path, line)
        }
        threadRef={threadRef}
        onOpen={openInEditor}
      />,
    );

    try {
      openContextMenu();
      await vi.waitFor(() => {
        const state = useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
        expect(state?.activeSurfaceId).toBe("file:src/index.ts");
        expect(state?.surfaces).toContainEqual({
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 12,
          revealRequestId: 1,
        });
      });

      openContextMenu();
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("src/index.ts:12"));
      openContextMenu();
      await vi.waitFor(() =>
        expect(writeText).toHaveBeenLastCalledWith("/workspace/project/src/index.ts:12"),
      );
      expect(contextMenuShow.mock.calls[0]?.[0]).toEqual([
        { id: "open", label: "Open in editor" },
        { id: "open-in-preview", label: "Open in file preview" },
        { id: "copy-relative", label: "Copy relative path" },
        { id: "copy-full", label: "Copy full path" },
      ]);
      expect(openInEditor).not.toHaveBeenCalled();
    } finally {
      writeText.mockRestore();
      await screen.unmount();
    }
  });
});
