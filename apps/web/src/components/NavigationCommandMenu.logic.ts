import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  deriveLogicalProjectKeyFromSettings,
  type ProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { getThreadSortTimestamp } from "@t3tools/client-runtime/state/thread-sort";

import { normalizeSearchText } from "../lib/utils";
import {
  buildThreadSearchTerms,
  RECENT_THREAD_LIMIT,
  searchCommandPaletteItems,
} from "./CommandPalette.logic";

const SEARCH_RESULT_LIMIT = 50;

export function resolveDraftProjectKeys(input: {
  readonly projects: readonly EnvironmentProject[];
  readonly draftLogicalProjectKeys: ReadonlySet<string>;
  readonly projectGroupingSettings: ProjectGroupingSettings;
}): ReadonlySet<string> {
  return new Set(
    input.projects
      .filter((project) =>
        input.draftLogicalProjectKeys.has(
          deriveLogicalProjectKeyFromSettings(project, input.projectGroupingSettings),
        ),
      )
      .map((project) => scopedProjectKey(scopeProjectRef(project.environmentId, project.id))),
  );
}

export function resolveProjectDraftId(input: {
  readonly projectRef: ScopedProjectRef;
  readonly projects: readonly EnvironmentProject[];
  readonly projectGroupingSettings: ProjectGroupingSettings;
  readonly getDraftIdByLogicalProjectKey: (logicalProjectKey: string) => string | null;
}): string | null {
  const project = input.projects.find(
    (candidate) =>
      candidate.environmentId === input.projectRef.environmentId &&
      candidate.id === input.projectRef.projectId,
  );
  if (!project) return null;
  const logicalProjectKey = deriveLogicalProjectKeyFromSettings(
    project,
    input.projectGroupingSettings,
  );
  return input.getDraftIdByLogicalProjectKey(logicalProjectKey);
}

interface NavigationThreadItem {
  readonly type: "thread";
  readonly ref: ScopedThreadRef;
  readonly title: string;
  readonly projectTitle: string;
  readonly workspaceRoot: string;
  readonly recencyAt: string;
  readonly thread: EnvironmentThreadShell;
}

interface NavigationProjectItem {
  readonly type: "project";
  readonly ref: ScopedProjectRef;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly latestThreadRecencyAt: string | null;
  readonly hasDraft: boolean;
}

export type NavigationCommandItem = NavigationThreadItem | NavigationProjectItem;

function recencyAt(thread: EnvironmentThreadShell): string {
  return thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function buildNavigationCommandResults(input: {
  readonly query: string;
  readonly projects: readonly EnvironmentProject[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly draftProjectKeys?: ReadonlySet<string>;
  /** Server-side message matches, keyed by `threadSearchMatchKey`. */
  readonly contentSnippetByThreadKey?: ReadonlyMap<string, string>;
}): NavigationCommandItem[] {
  const projectsByKey = new Map<string, EnvironmentProject>(
    input.projects.map(
      (project) =>
        [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
    ),
  );
  const latestThreadRecencyByProjectKey = new Map<string, string>();
  const threadItems: NavigationThreadItem[] = [];

  for (const thread of input.threads) {
    if (thread.archivedAt !== null || thread.lineage.relationshipToParent === "subagent") continue;
    const projectKey = scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId));
    const project = projectsByKey.get(projectKey);
    if (!project) continue;
    const threadRecencyAt = recencyAt(thread);
    const currentProjectRecency = latestThreadRecencyByProjectKey.get(projectKey) ?? null;
    if (timestamp(threadRecencyAt) > timestamp(currentProjectRecency)) {
      latestThreadRecencyByProjectKey.set(projectKey, threadRecencyAt);
    }
    threadItems.push({
      type: "thread",
      ref: { environmentId: thread.environmentId, threadId: thread.id },
      title: thread.title,
      projectTitle: project.title,
      workspaceRoot: project.workspaceRoot,
      recencyAt: threadRecencyAt,
      thread,
    });
  }
  threadItems.sort((left, right) => timestamp(right.recencyAt) - timestamp(left.recencyAt));

  if (normalizeSearchText(input.query).length === 0) {
    return threadItems.slice(0, RECENT_THREAD_LIMIT);
  }

  // Same matcher as the Mod+K palette, so both surfaces find the same threads.
  const searchableThreads = threadItems.map((item) => ({
    item,
    searchTerms: buildThreadSearchTerms(item.thread, {
      projectTitle: item.projectTitle,
      contentSnippet: input.contentSnippetByThreadKey?.get(threadSearchMatchKey(item.ref)),
    }),
    searchRecency: getThreadSortTimestamp(item.thread, "updated_at"),
  }));
  const searchableProjects = input.projects
    .map((project) => {
      const projectKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
      const item: NavigationProjectItem = {
        type: "project",
        ref: { environmentId: project.environmentId, projectId: project.id },
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        latestThreadRecencyAt: latestThreadRecencyByProjectKey.get(projectKey) ?? null,
        hasDraft: input.draftProjectKeys?.has(projectKey) ?? false,
      };
      return { item, searchTerms: [project.title, project.workspaceRoot] };
    })
    // Equal matches keep input order, so recently active projects win ties.
    .toSorted(
      (left, right) =>
        timestamp(right.item.latestThreadRecencyAt) - timestamp(left.item.latestThreadRecencyAt),
    );

  return searchCommandPaletteItems<{
    readonly item: NavigationCommandItem;
    readonly searchTerms: ReadonlyArray<string>;
    readonly searchRecency?: number;
  }>([...searchableThreads, ...searchableProjects], input.query)
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((result) => result.item);
}
