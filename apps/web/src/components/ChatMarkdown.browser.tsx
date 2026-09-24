import "../index.css";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { useRightPanelStore } from "../rightPanelStore";

const mocks = vi.hoisted(() => ({
  contextMenuShow: vi.fn(),
  openInEditor: vi.fn(),
  // Serves both query runners: asset URLs and workspace entry searches.
  queryRunner: vi.fn(),
  preferredEditor: "vscode" as string | null,
}));

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => null,
}));
vi.mock("../state/use-atom-query-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/use-atom-query-runner")>()),
  useAtomQueryRunner: () => mocks.queryRunner,
}));
vi.mock("../state/use-atom-command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/use-atom-command")>()),
  useAtomCommand: () => vi.fn(),
}));
vi.mock("../state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/session")>()),
  usePreparedConnection: () => ({ _tag: "Some", value: { httpBaseUrl: "http://localhost" } }),
}));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  readThreadShell: () => null,
  useProjects: () => [],
  useServerConfigs: () => new Map(),
}));
vi.mock("../remoteOpen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../remoteOpen")>()),
  useRemoteOpenResolution: () => ({ state: { mode: "local-exec" }, isResolved: true }),
}));
vi.mock("../editorPreferences", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../editorPreferences")>()),
  useOpenInPreferredEditor: () => mocks.openInEditor,
  usePreferredEditor: () => [mocks.preferredEditor, vi.fn()],
}));
vi.mock("../localApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../localApi")>()),
  readLocalApi: () => ({ contextMenu: { show: mocks.contextMenuShow } }),
}));

import ChatMarkdown from "./ChatMarkdown";

const threadRef = {
  environmentId: EnvironmentId.make("local"),
  threadId: ThreadId.make("thread-markdown-link"),
};
const cwd = "/workspace/project";

function panelState() {
  return useRightPanelStore.getState().byThreadKey[scopedThreadKey(threadRef)];
}

function openContextMenu(name: string) {
  const link = [...document.querySelectorAll<HTMLAnchorElement>("a")].find(
    (anchor) => anchor.textContent?.includes(name) === true,
  );
  if (!link) throw new Error(`Markdown file link not found: ${name}`);
  link.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }),
  );
}

// `isPreviewSupportedInRuntime` gates the integrated-browser actions on the
// desktop preview bridge.
function enableIntegratedBrowser() {
  Object.assign(window, { desktopBridge: { preview: {} } });
}

function assetRequestPaths() {
  return mocks.queryRunner.mock.calls.flatMap(([request]) =>
    request?.input?.resource ? [request.input.resource.path] : [],
  );
}

async function renderMarkdown(text: string) {
  return render(<ChatMarkdown text={text} cwd={cwd} threadRef={threadRef} />);
}

describe("ChatMarkdown file links", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.preferredEditor = "vscode";
    Reflect.deleteProperty(window, "desktopBridge");
    useRightPanelStore.setState({ byThreadKey: {} });
    document.body.innerHTML = "";
  });

  it("opens code paths in the preferred editor on primary click", async () => {
    mocks.openInEditor.mockResolvedValue(AsyncResult.success(undefined));
    const screen = await renderMarkdown("[index.ts](src/index.ts)");

    try {
      await page.getByRole("link", { name: "index.ts" }).click();
      await vi.waitFor(() =>
        expect(mocks.openInEditor).toHaveBeenCalledWith("/workspace/project/src/index.ts"),
      );
      expect(panelState()).toBeUndefined();
    } finally {
      await screen.unmount();
    }
  });

  it("resolves a bare filename through the workspace index before opening the editor", async () => {
    mocks.openInEditor.mockResolvedValue(AsyncResult.success(undefined));
    mocks.queryRunner.mockResolvedValue(
      AsyncResult.success({ entries: [{ path: "apps/web/src/ChatView.tsx", kind: "file" }] }),
    );
    const screen = await renderMarkdown("[ChatView.tsx](ChatView.tsx#L12)");

    try {
      await page.getByRole("link", { name: /ChatView\.tsx/ }).click();
      await vi.waitFor(() =>
        expect(mocks.openInEditor).toHaveBeenCalledWith(
          "/workspace/project/apps/web/src/ChatView.tsx:12",
        ),
      );
    } finally {
      await screen.unmount();
    }
  });

  it("opens the files panel when no code editor is available", async () => {
    mocks.preferredEditor = null;
    const screen = await renderMarkdown("[index.ts](src/index.ts)");

    try {
      await page.getByRole("link", { name: "index.ts" }).click();
      await vi.waitFor(() => expect(panelState()?.activeSurfaceId).toBe("file:src/index.ts"));
      expect(mocks.openInEditor).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps PDFs in the integrated browser and folders in the files panel", async () => {
    enableIntegratedBrowser();
    mocks.queryRunner.mockResolvedValue(AsyncResult.failure(Cause.fail("unavailable")));
    const screen = await renderMarkdown(
      "[guide.pdf](docs/guide.pdf) and [src](/workspace/project/src/)",
    );

    try {
      await page.getByRole("link", { name: "guide.pdf" }).click();
      await vi.waitFor(() =>
        expect(assetRequestPaths()).toEqual(["/workspace/project/docs/guide.pdf"]),
      );

      await page.getByRole("link", { name: "src" }).click();
      await vi.waitFor(() => expect(panelState()?.activeSurfaceId).toBe("file:src"));
      expect(mocks.openInEditor).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("routes the context menu to the integrated browser when available", async () => {
    enableIntegratedBrowser();
    mocks.queryRunner.mockResolvedValue(AsyncResult.failure(Cause.fail("unavailable")));
    mocks.contextMenuShow.mockResolvedValueOnce("open-in-browser");
    const screen = await renderMarkdown("[index.html](index.html)");

    try {
      openContextMenu("index.html");
      await vi.waitFor(() =>
        expect(assetRequestPaths()).toEqual(["/workspace/project/index.html"]),
      );
      expect(mocks.contextMenuShow.mock.calls[0]?.[0]).toEqual([
        { id: "open", label: "Open in VS Code" },
        { id: "open-in-browser", label: "Open in integrated browser" },
        { id: "open-in-preview", label: "Open in file preview" },
        { id: "copy-relative", label: "Copy relative path" },
        { id: "copy-full", label: "Copy full path" },
      ]);
      expect(mocks.openInEditor).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("opens file preview and copies relative and full paths from the context menu", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    mocks.contextMenuShow
      .mockResolvedValueOnce("open-in-preview")
      .mockResolvedValueOnce("copy-relative")
      .mockResolvedValueOnce("copy-full");
    const screen = await renderMarkdown("[index.ts](src/index.ts:12)");

    try {
      openContextMenu("index.ts");
      await vi.waitFor(() => {
        const state = panelState();
        expect(state?.activeSurfaceId).toBe("file:src/index.ts");
        expect(state?.surfaces).toContainEqual({
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 12,
          revealRequestId: 1,
        });
      });

      openContextMenu("index.ts");
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("project/src/index.ts:12"));
      openContextMenu("index.ts");
      await vi.waitFor(() =>
        expect(writeText).toHaveBeenLastCalledWith("/workspace/project/src/index.ts:12"),
      );
      expect(mocks.openInEditor).not.toHaveBeenCalled();
    } finally {
      writeText.mockRestore();
      await screen.unmount();
    }
  });
});
