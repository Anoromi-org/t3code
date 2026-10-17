import "../index.css";

import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  newThread: vi.fn(async () => undefined),
  projects: [] as EnvironmentProject[],
  threads: [] as EnvironmentThreadShell[],
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../keybindings"), async (original) => ({
  ...(await original()),
  resolveShortcutCommand: ((event: KeyboardEvent) =>
    event.ctrlKey && event.key.toLowerCase() === "e" ? "navigation.commandMenu" : null) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
  useThreadShells: (() => state.threads) as never,
}));
vi.mock(import("../hooks/useHandleNewThread"), async (original) => ({
  ...(await original()),
  useNewThreadHandler: (() => state.newThread) as never,
}));
vi.mock(import("../hooks/useThreadRouteTarget"), async (original) => ({
  ...(await original()),
  useThreadRouteRef: (() => null) as never,
}));

import { NavigationCommandMenuControl } from "./NavigationCommandMenuControl";

const project = {
  id: "project-nav",
  environmentId: "environment-nav",
  title: "Navigation project",
  workspaceRoot: "/workspace/navigation",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
} as EnvironmentProject;

const thread = (id: string, title: string, updatedAt: string) =>
  ({
    id,
    environmentId: project.environmentId,
    projectId: project.id,
    title,
    branch: null,
    worktreePath: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt,
    latestUserMessageAt: null,
    archivedAt: null,
  }) as EnvironmentThreadShell;

let root: Root;
let container: HTMLDivElement;

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
const menu = () => document.querySelector('[data-command-surface="navigation"]');
const input = () => document.querySelector<HTMLInputElement>('[role="combobox"]')!;
// Closing plays the dialog's exit transition before the popup unmounts.
const waitForMenuClosed = () => vi.waitFor(() => expect(menu()).toBeNull());
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.projects = [project];
  state.threads = [
    thread("thread-older", "Older thread", "2026-07-11T00:00:00.000Z"),
    thread("thread-newer", "Fix command hotkeys", "2026-07-12T00:00:00.000Z"),
  ];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<NavigationCommandMenuControl />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("navigation command menu", () => {
  it("toggles with Ctrl+E, including from its own search input", async () => {
    expect(menu()).toBeNull();
    await press("e", { ctrlKey: true });
    expect(menu()).not.toBeNull();
    expect(document.activeElement).toBe(input());

    await press("e", { ctrlKey: true }, input());
    await waitForMenuClosed();
  });

  it("opens the highlighted recent thread with the arrow keys and Enter", async () => {
    await press("e", { ctrlKey: true });
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining("Fix command hotkeys"),
      expect.stringContaining("Older thread"),
    ]);
    await press("ArrowDown", {}, input());
    await press("Enter", {}, input());

    expect(state.navigate).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "environment-nav", threadId: "thread-older" },
    });
    await waitForMenuClosed();
  });

  it("ignores Enter while an IME composition is active", async () => {
    await press("e", { ctrlKey: true });
    await press("Enter", { isComposing: true }, input());
    expect(state.navigate).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
  });

  it("starts a new thread for a searched project without a draft", async () => {
    await press("e", { ctrlKey: true });
    await act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(input(), "Navigation project");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const projectOption = options().find((option) =>
      option.textContent?.includes("/workspace/navigation"),
    );
    expect(projectOption?.textContent).toContain("New thread");
    await act(() => projectOption!.click());

    expect(state.newThread).toHaveBeenCalledWith({
      environmentId: "environment-nav",
      projectId: "project-nav",
    });
  });

  it("does not open over another command surface and keeps keys from global handlers", async () => {
    const palette = document.createElement("div");
    palette.dataset.commandSurface = "command-palette";
    document.body.append(palette);
    await press("e", { ctrlKey: true });
    expect(menu()).toBeNull();
    palette.remove();

    await press("e", { ctrlKey: true });
    const globalHandler = vi.fn();
    window.addEventListener("keydown", globalHandler);
    await press("ArrowDown", {}, input());
    window.removeEventListener("keydown", globalHandler);
    expect(globalHandler).not.toHaveBeenCalled();

    await press("Escape", {}, input());
    await waitForMenuClosed();
  });
});
