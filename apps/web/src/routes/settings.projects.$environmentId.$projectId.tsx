import { createFileRoute } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import { ProjectHyprnavSettingsPanel } from "../components/settings/ProjectHyprnavSettingsPanel";

export const Route = createFileRoute("/settings/projects/$environmentId/$projectId")({
  component: ProjectSettingsRoute,
});

function ProjectSettingsRoute() {
  const { environmentId, projectId } = Route.useParams();
  return (
    <ProjectHyprnavSettingsPanel
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
    />
  );
}
