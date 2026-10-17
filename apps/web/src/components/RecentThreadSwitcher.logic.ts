import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
} from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { DraftId, DraftThreadState } from "../composerDraftStore";
import type { RecentThreadTarget } from "../recentThreadStore";

export type RecentThreadSwitcherItem =
  | {
      readonly type: "thread";
      readonly target: RecentThreadTarget;
      readonly title: string;
      readonly projectTitle: string;
      readonly recencyAt: string;
      readonly thread: EnvironmentThreadShell;
    }
  | {
      readonly type: "draft";
      readonly target: RecentThreadTarget;
      readonly projectTitle: string;
    };

export function resolveRecentThreadSwitcherItems(input: {
  readonly targets: ReadonlyArray<RecentThreadTarget>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly draftsById: Readonly<Record<string, DraftThreadState>>;
}): RecentThreadSwitcherItem[] {
  const projectsByKey = new Map(
    input.projects.map(
      (project) =>
        [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
    ),
  );
  const threadsByKey = new Map(
    input.threads.flatMap((thread) =>
      thread.archivedAt === null
        ? [[scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id }), thread]]
        : [],
    ),
  );

  const resolveServer = (
    target: Extract<RecentThreadTarget, { kind: "server" }>,
  ): RecentThreadSwitcherItem | null => {
    const thread = threadsByKey.get(scopedThreadKey(target.threadRef));
    if (!thread) return null;
    const project = projectsByKey.get(
      scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
    );
    if (!project) return null;
    return {
      type: "thread",
      target,
      title: thread.title,
      projectTitle: project.title,
      recencyAt: thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
      thread,
    };
  };

  const seen = new Set<string>();
  const items: RecentThreadSwitcherItem[] = [];
  for (const target of input.targets) {
    let item: RecentThreadSwitcherItem | null;
    if (target.kind === "server") {
      item = resolveServer(target);
    } else {
      const draft = input.draftsById[target.draftId as DraftId];
      if (!draft) continue;
      if (draft.promotedTo) {
        item = resolveServer({ kind: "server", threadRef: draft.promotedTo });
      } else {
        const project = projectsByKey.get(
          scopedProjectKey(scopeProjectRef(draft.environmentId, draft.projectId)),
        );
        item = project
          ? {
              type: "draft",
              target,
              projectTitle: project.title,
            }
          : null;
      }
    }
    if (!item) continue;
    const key =
      item.target.kind === "server"
        ? `server:${scopedThreadKey(item.target.threadRef)}`
        : `draft:${item.target.draftId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
  return items;
}
