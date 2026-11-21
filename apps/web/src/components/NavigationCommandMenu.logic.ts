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
import {
  threadSearchMatchKey,
  threadSearchSubject,
} from "@t3tools/client-runtime/state/thread-search";
import {
  foldSearchQuery,
  rankSearchItems,
  scoreSearchTerms,
  scoreThreadSearch,
} from "@t3tools/shared/paletteSearch";

import { RECENT_THREAD_LIMIT } from "./CommandPalette.logic";

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

interface NavigationSearchMatch {
  readonly score: number;
  readonly quality: number;
  readonly strong: boolean;
}

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
  readonly now?: number;
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

  if (foldSearchQuery(input.query).length === 0) {
    return threadItems.slice(0, RECENT_THREAD_LIMIT);
  }

  // Same ranking as the Mod+K palette, so both surfaces find the same threads.
  const normalizedQuery = foldSearchQuery(input.query);
  const now = input.now ?? Date.now();
  const searchableProjects = input.projects
    .map((project): NavigationProjectItem => {
      const projectKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
      return {
        type: "project",
        ref: { environmentId: project.environmentId, projectId: project.id },
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        latestThreadRecencyAt: latestThreadRecencyByProjectKey.get(projectKey) ?? null,
        hasDraft: input.draftProjectKeys?.has(projectKey) ?? false,
      };
    })
    // Equal matches keep input order, so recently active projects win ties.
    .toSorted(
      (left, right) =>
        timestamp(right.latestThreadRecencyAt) - timestamp(left.latestThreadRecencyAt),
    );
  const ranked = rankSearchItems<NavigationCommandItem, NavigationSearchMatch>(
    [...threadItems, ...searchableProjects],
    (item, options) =>
      item.type === "thread"
        ? scoreThreadSearch(
            normalizedQuery,
            threadSearchSubject(item.thread, item.projectTitle),
            now,
            { ...options, picks: false },
          )
        : scoreSearchTerms(normalizedQuery, [item.title, item.workspaceRoot], options),
  ).map((entry) => entry.item);
  // The server already matched these by message text, which the local fields cannot see.
  const rankedSet = new Set(ranked);
  const contentSnippets = input.contentSnippetByThreadKey;
  const contentMatches = contentSnippets
    ? threadItems.filter(
        (item) => !rankedSet.has(item) && contentSnippets.has(threadSearchMatchKey(item.ref)),
      )
    : [];
  return [...ranked, ...contentMatches].slice(0, SEARCH_RESULT_LIMIT);
}
