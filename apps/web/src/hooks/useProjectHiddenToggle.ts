import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { projectEnvironment } from "../state/projects";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { stackedThreadToast, toastManager } from "../components/ui/toast";

interface HideableProjectGroup {
  readonly displayName: string;
  readonly memberProjects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }>;
}

/** Hides or shows every checkout of a project group, stopping at the first failure. */
export function useProjectHiddenToggle() {
  const updateProject = useOrchestrationCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  return async (group: HideableProjectGroup, hidden: boolean): Promise<boolean> => {
    for (const member of group.memberProjects) {
      const result = await updateProject({
        environmentId: member.environmentId,
        input: { projectId: member.id, hidden },
      });
      if (result._tag === "Success") continue;
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: hidden
              ? `Failed to hide ${group.displayName}`
              : `Failed to show ${group.displayName}`,
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return false;
    }
    return true;
  };
}
