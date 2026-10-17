import { EnvironmentId, ProjectId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";
import { DraftId, type DraftThreadState } from "../composerDraftStore";
import type { RecentThreadTarget } from "../recentThreadStore";
import { resolveRecentThreadSwitcherItems } from "./RecentThreadSwitcher.logic";

const environmentId = EnvironmentId.make("environment-switcher");
const otherEnvironmentId = EnvironmentId.make("environment-switcher-other");
const projectId = ProjectId.make("project-switcher");

const project = {
  id: projectId,
  environmentId,
  title: "Switcher project",
  workspaceRoot: "/workspace/switcher",
} as EnvironmentProject;

function thread(
  id: string,
  options: {
    environmentId?: EnvironmentId;
    archivedAt?: string | null;
  } = {},
): EnvironmentThreadShell {
  return {
    id: ThreadId.make(id),
    environmentId: options.environmentId ?? environmentId,
    projectId,
    title: `Thread ${id}`,
    archivedAt: options.archivedAt ?? null,
    latestUserMessageAt: null,
    updatedAt: "2026-07-20T12:00:00.000Z",
    createdAt: "2026-07-20T11:00:00.000Z",
  } as EnvironmentThreadShell;
}

function serverTarget(id: string, targetEnvironmentId = environmentId): RecentThreadTarget {
  return {
    kind: "server",
    threadRef: {
      environmentId: targetEnvironmentId,
      threadId: ThreadId.make(id),
    },
  };
}

function draftState(promotedTo: ScopedThreadRef | null = null): DraftThreadState {
  return {
    threadId: ThreadId.make("draft-thread"),
    environmentId,
    projectId,
    logicalProjectKey: "logical-project",
    createdAt: "2026-07-20T13:00:00.000Z",
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    envMode: "local",
    startFromOrigin: false,
    promotedTo,
  } as DraftThreadState;
}

describe("recent thread switcher item resolution", () => {
  it("preserves MRU order across real threads and drafts", () => {
    const draftId = DraftId.make("draft-switcher");
    const items = resolveRecentThreadSwitcherItems({
      targets: [serverTarget("b"), { kind: "draft", draftId }, serverTarget("a")],
      projects: [project],
      threads: [thread("a"), thread("b")],
      draftsById: { [draftId]: draftState() },
    });

    expect(items.map((item) => (item.type === "thread" ? item.title : "New thread"))).toEqual([
      "Thread b",
      "New thread",
      "Thread a",
    ]);
    expect(items[1]).toMatchObject({ type: "draft", projectTitle: "Switcher project" });
  });

  it("canonicalizes promoted drafts and deduplicates the real thread", () => {
    const draftId = DraftId.make("draft-promoted");
    const promotedTarget = serverTarget("promoted");
    const items = resolveRecentThreadSwitcherItems({
      targets: [{ kind: "draft", draftId }, promotedTarget],
      projects: [project],
      threads: [thread("promoted")],
      draftsById: {
        [draftId]: draftState(
          (promotedTarget as Extract<RecentThreadTarget, { kind: "server" }>).threadRef,
        ),
      },
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "thread", title: "Thread promoted" });
  });

  it("prunes archived, missing, cleared-draft, and projectless entries", () => {
    const missingDraftId = DraftId.make("missing-draft");
    const items = resolveRecentThreadSwitcherItems({
      targets: [
        serverTarget("archived"),
        serverTarget("missing"),
        { kind: "draft", draftId: missingDraftId },
      ],
      projects: [project],
      threads: [thread("archived", { archivedAt: "2026-07-21T00:00:00.000Z" })],
      draftsById: {},
    });
    expect(items).toEqual([]);
  });

  it("keeps identical thread ids distinct across environments", () => {
    const otherProject = { ...project, environmentId: otherEnvironmentId };
    const items = resolveRecentThreadSwitcherItems({
      targets: [serverTarget("shared"), serverTarget("shared", otherEnvironmentId)],
      projects: [project, otherProject],
      threads: [thread("shared"), thread("shared", { environmentId: otherEnvironmentId })],
      draftsById: {},
    });

    expect(items).toHaveLength(2);
    expect(
      items.map((item) =>
        item.target.kind === "server" ? item.target.threadRef.environmentId : null,
      ),
    ).toEqual([environmentId, otherEnvironmentId]);
  });
});
