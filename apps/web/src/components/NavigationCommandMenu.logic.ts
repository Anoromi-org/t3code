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
  insertRankedSearchResult,
  normalizeSearchQuery,
  scoreQueryMatch,
  type RankedSearchResult,
} from "@t3tools/shared/searchRanking";

export const RECENT_THREAD_LIMIT = 12;
export const SEARCH_RESULT_LIMIT = 20;

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

export type NavigationCommandItem =
  | {
      readonly type: "thread";
      readonly ref: ScopedThreadRef;
      readonly title: string;
      readonly projectTitle: string;
      readonly workspaceRoot: string;
      readonly branch: string | null;
      readonly worktreePath: string | null;
      readonly recencyAt: string;
      readonly thread: EnvironmentThreadShell;
    }
  | {
      readonly type: "project";
      readonly ref: ScopedProjectRef;
      readonly title: string;
      readonly workspaceRoot: string;
      readonly latestThreadRecencyAt: string | null;
      readonly hasDraft: boolean;
    };

function recencyAt(thread: EnvironmentThreadShell): string {
  return thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
}

function timestamp(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function itemRecency(item: NavigationCommandItem): string | null {
  return item.type === "thread" ? item.recencyAt : item.latestThreadRecencyAt;
}

function searchScore(item: NavigationCommandItem, query: string): number | null {
  const fields =
    item.type === "thread"
      ? [
          [item.title, 0],
          [item.projectTitle, 25],
          [item.branch ?? "", 40],
          [item.worktreePath ?? "", 45],
          [item.workspaceRoot, 50],
        ]
      : [
          [item.title, 5],
          [item.workspaceRoot, 35],
        ];

  let best: number | null = null;
  for (const [rawValue, weight] of fields) {
    const value = normalizeSearchQuery(String(rawValue));
    const score = scoreQueryMatch({
      value,
      query,
      exactBase: 0,
      prefixBase: 10,
      boundaryBase: 20,
      includesBase: 35,
      fuzzyBase: 60,
    });
    if (score !== null) {
      best = Math.min(best ?? Number.POSITIVE_INFINITY, score + Number(weight));
    }
  }
  return best;
}

export function buildNavigationCommandResults(input: {
  readonly query: string;
  readonly projects: readonly EnvironmentProject[];
  readonly threads: readonly EnvironmentThreadShell[];
  readonly draftProjectKeys?: ReadonlySet<string>;
}): NavigationCommandItem[] {
  const projectsByKey = new Map<string, EnvironmentProject>(
    input.projects.map(
      (project) =>
        [scopedProjectKey(scopeProjectRef(project.environmentId, project.id)), project] as const,
    ),
  );
  const latestThreadRecencyByProjectKey = new Map<string, string>();
  const threadItems: NavigationCommandItem[] = [];

  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
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
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      recencyAt: threadRecencyAt,
      thread,
    });
  }

  const query = normalizeSearchQuery(input.query);
  if (!query) {
    return threadItems
      .toSorted((left, right) => timestamp(itemRecency(right)) - timestamp(itemRecency(left)))
      .slice(0, RECENT_THREAD_LIMIT);
  }

  const items: NavigationCommandItem[] = [
    ...threadItems,
    ...input.projects.map((project) => ({
      type: "project" as const,
      ref: { environmentId: project.environmentId, projectId: project.id },
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      latestThreadRecencyAt:
        latestThreadRecencyByProjectKey.get(
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        ) ?? null,
      hasDraft:
        input.draftProjectKeys?.has(
          scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
        ) ?? false,
    })),
  ];
  const ranked: RankedSearchResult<NavigationCommandItem>[] = [];
  for (const item of items) {
    const score = searchScore(item, query);
    if (score === null) continue;
    const recencyTimestamp = timestamp(itemRecency(item));
    const recencyTieBreaker = Number.isFinite(recencyTimestamp)
      ? String(9_999_999_999_999 - recencyTimestamp).padStart(13, "0")
      : "9999999999999";
    insertRankedSearchResult(
      ranked,
      {
        item,
        score,
        tieBreaker: `${recencyTieBreaker}:${item.title}`,
      },
      SEARCH_RESULT_LIMIT,
    );
  }

  return ranked.map((result) => result.item);
}
