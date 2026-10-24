/**
 * Fork: hidden projects stay out of aggregate lists (every project at once)
 * unless the user chose to show them. A view scoped to one project, a route to
 * one of its threads, and search are explicit intent and ignore the flag.
 */
export interface HiddenProjectCandidate {
  readonly environmentId: string;
  readonly id: string;
  readonly hidden?: boolean | undefined;
}

export interface ProjectScopedItem {
  readonly environmentId: string;
  readonly projectId: string;
}

export const projectVisibilityKey = (environmentId: string, projectId: string): string =>
  `${environmentId}:${projectId}`;

/** Keys of projects an aggregate view leaves out; empty while hidden projects are shown. */
export function hiddenProjectKeys(
  projects: ReadonlyArray<HiddenProjectCandidate>,
  showHidden: boolean,
): ReadonlySet<string> {
  if (showHidden) return EMPTY_KEYS;
  const keys = new Set<string>();
  for (const project of projects) {
    if (project.hidden === true) keys.add(projectVisibilityKey(project.environmentId, project.id));
  }
  return keys.size === 0 ? EMPTY_KEYS : keys;
}

export function isInHiddenProject(
  item: ProjectScopedItem,
  hiddenKeys: ReadonlySet<string>,
): boolean {
  return (
    hiddenKeys.size > 0 && hiddenKeys.has(projectVisibilityKey(item.environmentId, item.projectId))
  );
}

/**
 * Drops items of hidden projects. `keep` rescues an item the user is looking at,
 * such as the routed thread, so opening it never makes it vanish from the list.
 */
export function excludeHiddenProjectItems<T extends ProjectScopedItem>(
  items: ReadonlyArray<T>,
  hiddenKeys: ReadonlySet<string>,
  keep?: (item: T) => boolean,
): ReadonlyArray<T> {
  if (hiddenKeys.size === 0) return items;
  return items.filter((item) => !isInHiddenProject(item, hiddenKeys) || keep?.(item) === true);
}

/**
 * Candidates for an automatic project choice (a default or most recent
 * project); falls back to all projects when every one is hidden.
 */
export function preferVisibleProjects<T extends { readonly hidden?: boolean | undefined }>(
  projects: ReadonlyArray<T>,
  showHidden: boolean,
): ReadonlyArray<T> {
  if (showHidden || !projects.some((project) => project.hidden === true)) return projects;
  const visible = projects.filter((project) => project.hidden !== true);
  return visible.length > 0 ? visible : projects;
}

const EMPTY_KEYS: ReadonlySet<string> = new Set();
