import "../index.css";

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render, stubGlobal } from "../../test/render";

import { useRightPanelStore } from "../rightPanelStore";

const mocks = vi.hoisted(() => ({
  contextMenuShow: vi.fn(),
  openInEditor: vi.fn(),
  // Serves both query runners: asset URLs and workspace entry searches.
  queryRunner: vi.fn(),
  preferredEditor: "vscode" as string | null,
}));

// Atoms derived from the server config run in the real registry over a missing config.
vi.mock(import("../state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const noConfig = Atom.make(null);
  return {
    ...actual,
    serverEnvironment: { ...actual.serverEnvironment, configValueAtom: (() => noConfig) as never },
  };
});
// A standard client session, so environment-owned file links can open.
vi.mock(import("../state/session"), async (original) => {
  const { AuthStandardClientScopes } = await import("@t3tools/contracts");
  const granted = new Set<string>(AuthStandardClientScopes);
  const hasScope = (environmentId: unknown, scope: string) =>
    environmentId !== null && granted.has(scope);
  return {
    ...(await original()),
    useEnvironmentScope: hasScope as never,
    readEnvironmentScope: hasScope as never,
    usePreparedConnection: (() => ({
      _tag: "Some",
      value: { httpBaseUrl: "http://localhost" },
    })) as never,
  };
});
vi.mock("../state/use-atom-query-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/use-atom-query-runner")>()),
  useAtomQueryRunner: () => mocks.queryRunner,
}));
vi.mock("../state/use-atom-command", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/use-atom-command")>()),
  useAtomCommand: () => vi.fn(),
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

// Upstream resolves every file link through the workspace index; an empty index keeps the link.
const EMPTY_WORKSPACE_INDEX = AsyncResult.success({ entries: [] });

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
async function renderMarkdown(text: string, options: { integratedBrowser?: boolean } = {}) {
  vi.clearAllMocks();
  if (mocks.queryRunner.getMockImplementation() === undefined) {
    mocks.queryRunner.mockResolvedValue(EMPTY_WORKSPACE_INDEX);
  }
  useRightPanelStore.setState({ byThreadKey: {} });
  const bridge = options.integratedBrowser
    ? stubGlobal("desktopBridge", { preview: {} })
    : undefined;
  const screen = await render(<ChatMarkdown text={text} cwd={cwd} threadRef={threadRef} />, {
    router: false,
  });
  return {
    async [Symbol.asyncDispose]() {
      await screen[Symbol.asyncDispose]();
      bridge?.[Symbol.dispose]();
      mocks.preferredEditor = "vscode";
      mocks.queryRunner.mockReset();
      useRightPanelStore.setState({ byThreadKey: {} });
    },
  };
}

describe("ChatMarkdown file links", () => {
  it("opens code paths in the preferred editor on primary click", async () => {
    mocks.openInEditor.mockResolvedValue(AsyncResult.success(undefined));
    await using _screen = await renderMarkdown("[index.ts](src/index.ts)");

    await page.getByRole("link", { name: "index.ts" }).click();
    await vi.waitFor(() =>
      expect(mocks.openInEditor).toHaveBeenCalledWith("/workspace/project/src/index.ts"),
    );
    expect(panelState()).toBeUndefined();
  });

  it("resolves a bare filename through the workspace index before opening the editor", async () => {
    mocks.openInEditor.mockResolvedValue(AsyncResult.success(undefined));
    mocks.queryRunner.mockResolvedValue(
      AsyncResult.success({ entries: [{ path: "apps/web/src/ChatView.tsx", kind: "file" }] }),
    );
    await using _screen = await renderMarkdown("[ChatView.tsx](ChatView.tsx#L12)");

    await page.getByRole("link", { name: /ChatView\.tsx/ }).click();
    await vi.waitFor(() =>
      expect(mocks.openInEditor).toHaveBeenCalledWith(
        "/workspace/project/apps/web/src/ChatView.tsx:12",
      ),
    );
  });

  it("opens the files panel when no code editor is available", async () => {
    mocks.preferredEditor = null;
    await using _screen = await renderMarkdown("[index.ts](src/index.ts)");

    await page.getByRole("link", { name: "index.ts" }).click();
    await vi.waitFor(() => expect(panelState()?.activeSurfaceId).toBe("file:src/index.ts"));
    expect(mocks.openInEditor).not.toHaveBeenCalled();
  });

  it("keeps PDFs and folders out of the editor", async () => {
    mocks.queryRunner.mockResolvedValue(AsyncResult.failure(Cause.fail("unavailable")));
    await using _screen = await renderMarkdown(
      "[guide.pdf](docs/guide.pdf) and [src](/workspace/project/src/)",
      { integratedBrowser: true },
    );

    // The integrated browser owns PDFs (upstream behavior); the editor never opens them.
    await page.getByRole("link", { name: "guide.pdf" }).click();

    await page.getByRole("link", { name: "src" }).click();
    await vi.waitFor(() => expect(panelState()?.activeSurfaceId).toBe("file:src"));
    expect(mocks.openInEditor).not.toHaveBeenCalled();
  });

  it("lists the integrated browser and file preview in the context menu", async () => {
    mocks.queryRunner.mockResolvedValue(AsyncResult.failure(Cause.fail("unavailable")));
    mocks.contextMenuShow.mockResolvedValueOnce("open-in-browser");
    await using _screen = await renderMarkdown("[index.html](index.html)", {
      integratedBrowser: true,
    });

    openContextMenu("index.html");
    await vi.waitFor(() => expect(mocks.contextMenuShow).toHaveBeenCalledOnce());
    expect(mocks.contextMenuShow.mock.calls[0]?.[0]).toEqual([
      { id: "open", label: "Open in VS Code" },
      { id: "open-in-browser", label: "Open in integrated browser" },
      { id: "open-in-preview", label: "Open in file preview" },
      { id: "copy-relative", label: "Copy relative path" },
      { id: "copy-full", label: "Copy full path" },
    ]);
    expect(mocks.openInEditor).not.toHaveBeenCalled();
  });

  it("opens file preview and copies relative and full paths from the context menu", async () => {
    // Without ClipboardItem the link copies through writeText, which the test can read.
    using _clipboardItem = stubGlobal("ClipboardItem", undefined);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    mocks.contextMenuShow
      .mockResolvedValueOnce("open-in-preview")
      .mockResolvedValueOnce("copy-relative")
      .mockResolvedValueOnce("copy-full");
    await using _screen = await renderMarkdown("[index.ts](src/index.ts:12)");

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
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("src/index.ts:12"));
    openContextMenu("index.ts");
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith("/workspace/project/src/index.ts:12"),
    );
    expect(mocks.openInEditor).not.toHaveBeenCalled();
    writeText.mockRestore();
  });
});
