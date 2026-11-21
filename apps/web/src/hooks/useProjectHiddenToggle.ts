import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useProjectGroupUpdate } from "./useProjectGroupUpdate";

interface HideableProjectGroup {
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly environmentLabel: string | null;
  }>;
}

/** Hides or shows every checkout of a project group, stopping at the first failure. */
export function useProjectHiddenToggle() {
  const gt = useGT();
  const { updateProjectGroup } = useProjectGroupUpdate();
  return async (group: HideableProjectGroup, hidden: boolean): Promise<boolean> => {
    const result = await updateProjectGroup(
      group.memberProjects,
      { hidden },
      hidden
        ? gt("Failed to hide {project}", { project: group.displayName })
        : gt("Failed to show {project}", { project: group.displayName }),
    );
    return result._tag === "Success";
  };
}
