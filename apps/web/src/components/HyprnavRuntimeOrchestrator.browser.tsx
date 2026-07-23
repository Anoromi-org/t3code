import type { DesktopBridge } from "@t3tools/contracts";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const state = vi.hoisted(() => ({
  primaryEnvironmentId: "55d399e3-b31f-4111-b7dd-09ff93d9bb77",
  sync: vi.fn(),
}));

const projectId = ProjectId.make("project-1");
const firstThreadId = ThreadId.make("thread-1");
const secondThreadId = ThreadId.make("thread-2");
const project = {
  environmentId: EnvironmentId.make(state.primaryEnvironmentId),
  id: projectId,
  workspaceRoot: "/repo",
  hyprnav: null,
};
const threads = new Map([
  [
    firstThreadId,
    {
      environmentId: EnvironmentId.make(state.primaryEnvironmentId),
      id: firstThreadId,
      projectId,
      title: "First thread",
      worktreePath: "/repo/worktrees/first",
    },
  ],
  [
    secondThreadId,
    {
      environmentId: EnvironmentId.make(state.primaryEnvironmentId),
      id: secondThreadId,
      projectId,
      title: "Second thread",
      worktreePath: "/repo/worktrees/second",
    },
  ],
]);

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => [],
}));
vi.mock("../editorPreferences", () => ({ resolveAndPersistPreferredEditor: () => null }));
vi.mock("../env", () => ({ isElectron: true }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: unknown) => unknown) =>
    select({ defaultProjectHyprnavSettings: { bindings: [] } }),
}));
vi.mock("../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make(state.primaryEnvironmentId),
}));
vi.mock("../state/entities", () => ({
  useProject: () => project,
  useThreadShell: (ref: { readonly threadId: string }) =>
    threads.get(ref.threadId as never) ?? null,
}));
vi.mock("../state/server", () => ({ primaryServerAvailableEditorsAtom: {} }));
vi.mock("./ui/toast", () => ({ toastManager: { add: vi.fn() } }));

import { hyprnavPublicationHistory } from "../hyprnavRuntime";
import { HyprnavRuntimeOrchestrator } from "./HyprnavRuntimeOrchestrator";

describe("HyprnavRuntimeOrchestrator", () => {
  beforeEach(() => {
    state.sync.mockReset();
    state.sync.mockResolvedValue({ status: "ok", message: null, appliedScopes: ["thread"] });
    window.desktopBridge = {
      syncHyprnavEnvironment: state.sync,
    } as unknown as DesktopBridge;
    hyprnavPublicationHistory.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    delete window.desktopBridge;
    hyprnavPublicationHistory.clear();
    window.localStorage.clear();
  });

  it("publishes and locks the final UUID-scoped thread after rerendering", async () => {
    const environmentId = EnvironmentId.make(state.primaryEnvironmentId);
    const view = await render(
      <HyprnavRuntimeOrchestrator threadRef={{ environmentId, threadId: firstThreadId }} />,
    );
    await vi.waitFor(() => expect(state.sync).toHaveBeenCalledTimes(1));

    await view.rerender(
      <HyprnavRuntimeOrchestrator threadRef={{ environmentId, threadId: secondThreadId }} />,
    );
    await vi.waitFor(() => expect(state.sync).toHaveBeenCalledTimes(2));

    expect(state.sync.mock.calls.at(-1)?.[0]).toMatchObject({
      threadId: secondThreadId,
      worktreePath: "/repo/worktrees/second",
      lock: true,
    });
  });
});
