import "../index.css";

import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useRecentThreadStore } from "../recentThreadStore";
import { render } from "../browserTestRender";

const state = vi.hoisted(() => ({
  navigate: vi.fn(async () => undefined),
  projects: [] as EnvironmentProject[],
  threads: [] as EnvironmentThreadShell[],
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useNavigate: (() => state.navigate) as never,
}));
vi.mock(import("../state/entities"), async (original) => ({
  ...(await original()),
  useProjects: (() => state.projects) as never,
  useThreadShells: (() => state.threads) as never,
}));
vi.mock(import("../hooks/useThreadRouteTarget"), async (original) => ({
  ...(await original()),
  useThreadRouteTarget: (() => null) as never,
}));

import { RecentThreadSwitcherControl } from "./RecentThreadSwitcherControl";

const environmentId = EnvironmentId.make("environment-switcher");
const project = {
  id: "project-switcher",
  environmentId,
  title: "Switcher project",
  workspaceRoot: "/workspace/switcher",
  createdAt: "2026-07-10T00:00:00.000Z",
  updatedAt: "2026-07-10T00:00:00.000Z",
} as EnvironmentProject;
const thread = (id: string, title: string) =>
  ({
    id: ThreadId.make(id),
    environmentId,
    projectId: project.id,
    title,
    branch: null,
    worktreePath: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    archivedAt: null,
  }) as EnvironmentThreadShell;
const visit = (id: string) => ({
  kind: "server" as const,
  threadRef: { environmentId, threadId: ThreadId.make(id) },
});

let emit: (action: string) => void = () => undefined;
let view: Awaited<ReturnType<typeof render>>;
const surface = () => document.querySelector('[data-command-surface="thread-switcher"]');

beforeEach(async () => {
  vi.clearAllMocks();
  state.projects = [project];
  state.threads = [
    thread("thread-a", "First"),
    thread("thread-b", "Second"),
    thread("thread-c", "Third"),
  ];
  Object.assign(window, {
    desktopBridge: {
      onThreadSwitcherAction: (listener: (action: string) => void) => {
        emit = listener;
        return () => {
          emit = () => undefined;
        };
      },
    },
  });
  // Most recent last: C was visited most recently, then B, then A.
  for (const id of ["thread-a", "thread-b", "thread-c"]) {
    useRecentThreadStore.getState().recordVisit(visit(id));
  }
  view = await render(<RecentThreadSwitcherControl />);
});

afterEach(() => {
  useRecentThreadStore.getState().cancel();
  useRecentThreadStore.setState({ history: [], cycle: null });
  Reflect.deleteProperty(window, "desktopBridge");
});

const act$ = (action: string) => act(() => emit(action));

describe("recent thread switcher", () => {
  it("cycles the frozen recent list and navigates once on commit", async () => {
    await act$("advance-forward");
    expect(surface()).not.toBeNull();
    await act$("advance-forward");
    await act$("commit");

    expect(state.navigate).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: "thread-a" },
    });
    await vi.waitFor(() => expect(surface()).toBeNull());
  });

  it("cancels without navigating", async () => {
    await act$("advance-forward");
    await act$("cancel");
    expect(state.navigate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(surface()).toBeNull());
  });

  it("does not commit a thread removed during the gesture", async () => {
    await act$("advance-forward");
    state.threads = state.threads.filter((entry) => entry.id !== "thread-b");
    await view.rerender(<RecentThreadSwitcherControl />);
    await act$("commit");
    expect(state.navigate).not.toHaveBeenCalledWith(
      expect.objectContaining({ params: { environmentId, threadId: "thread-b" } }),
    );
  });

  it("does not open over another command surface", async () => {
    const palette = document.createElement("div");
    palette.dataset.commandSurface = "command-palette";
    document.body.append(palette);
    await act$("advance-forward");
    expect(surface()).toBeNull();
    palette.remove();
  });
});
