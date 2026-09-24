import type { EnvironmentId } from "@t3tools/contracts";

import { searchableSetting } from "./settingsSearch";

/**
 * A logical project group, optionally narrowed to one checkout. Without a
 * checkout the Hyprnav section edits the whole group; with one it edits that
 * checkout's entry.
 */
export interface ProjectHyprnavNavigationTarget {
  readonly projectKey: string;
  readonly checkout?: {
    readonly environmentId: EnvironmentId;
    readonly physicalProjectKey: string;
  };
}

/** Navigation options that open a project's Hyprnav section in Settings. */
export function projectHyprnavSettingsRoute(target: ProjectHyprnavNavigationTarget) {
  return {
    to: "/settings/projects" as const,
    search: {
      project: target.projectKey,
      machine: target.checkout?.environmentId,
      checkout: target.checkout?.physicalProjectKey,
    },
    hash: searchableSetting("project-hyprnav").id,
  };
}
