import { hiddenProjectKeys } from "@t3tools/client-runtime/state/hidden-projects";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

import { scopedProjectKey } from "../../lib/scopedEntities";
import type { HomeListFilterMenuProject } from "./home-list-filter-menu";
import type { HomeProjectScope } from "./homeThreadList";

export const HIDDEN_PROJECT_LABEL = "Hidden";

/**
 * A grouped project (several checkouts of one repository) counts as hidden only when every
 * checkout is, so hiding one checkout never hides the others from pickers.
 */
export function isHiddenProjectGroup(
  projects: ReadonlyArray<Pick<EnvironmentProject, "hidden">>,
): boolean {
  return projects.length > 0 && projects.every((project) => project.hidden);
}

/** Pickers keep hidden projects selectable, after every visible one. */
export function hiddenProjectScopesLast(
  scopes: ReadonlyArray<HomeProjectScope>,
): ReadonlyArray<HomeProjectScope> {
  const hidden = scopes.filter((scope) => isHiddenProjectGroup(scope.projects));
  if (hidden.length === 0) return scopes;
  return [...scopes.filter((scope) => !isHiddenProjectGroup(scope.projects)), ...hidden];
}

export function buildHomeProjectFilterOptions(
  scopes: ReadonlyArray<HomeProjectScope>,
): ReadonlyArray<HomeListFilterMenuProject> {
  return hiddenProjectScopesLast(scopes).map((scope) => ({
    key: scope.key,
    label: scope.title,
    hidden: isHiddenProjectGroup(scope.projects),
  }));
}

/**
 * Projects the all-project thread list leaves out. A project filter or a search query is explicit
 * intent, so hidden projects show while either is active.
 */
export function homeListHiddenProjectKeys(input: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly showHiddenProjects: boolean;
  readonly projectScoped: boolean;
  readonly searchQuery: string;
}): ReadonlySet<string> {
  return hiddenProjectKeys(
    input.projects,
    input.showHiddenProjects || input.projectScoped || input.searchQuery.trim().length > 0,
  );
}

/** Row project labels, marking threads whose own project is hidden. */
export function buildHomeProjectRowTitles(
  scopes: ReadonlyArray<HomeProjectScope>,
): ReadonlyMap<string, string> {
  return new Map(
    scopes.flatMap((scope) =>
      scope.projects.map(
        (project) =>
          [
            scopedProjectKey(project.environmentId, project.id),
            project.hidden ? `${scope.title} · ${HIDDEN_PROJECT_LABEL}` : scope.title,
          ] as const,
      ),
    ),
  );
}
