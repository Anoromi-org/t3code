import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { Button } from "../ui/button";

export interface ProjectHyprnavNavigationTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

export function projectHyprnavSettingsRoute(target: ProjectHyprnavNavigationTarget) {
  return {
    to: "/settings/projects/$environmentId/$projectId" as const,
    params: target,
  };
}

export function ProjectHyprnavSettingsButton({
  target,
}: {
  readonly target: ProjectHyprnavNavigationTarget;
}) {
  const navigate = useNavigate();
  return (
    <Button
      size="xs"
      variant="outline"
      type="button"
      onClick={() => void navigate(projectHyprnavSettingsRoute(target))}
    >
      Configure
    </Button>
  );
}
