import type { EnvironmentId } from "@t3tools/contracts";

import { HIDDEN_PROJECT_LABEL } from "./hidden-projects";

export interface HomeListFilterMenuEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export interface HomeListFilterMenuProject {
  readonly key: string;
  readonly label: string;
  readonly hidden: boolean;
}

/** Menu id for native menus keyed by action id; kept outside the `project:` id namespace. */
export const SHOW_HIDDEN_PROJECTS_ACTION_ID = "show-hidden-projects";
export const SHOW_HIDDEN_PROJECTS_TITLE = "Show hidden projects";
export const SHOW_HIDDEN_PROJECTS_SUBTITLE = "Include them in the all-projects list";

type HomeListFilterMenuAction = {
  readonly type: "action";
  readonly title: string;
  readonly subtitle?: string;
  readonly state?: "on" | "off";
  readonly onPress: () => void;
};

type HomeListFilterMenuSubmenu = {
  readonly type: "submenu";
  readonly title: string;
  readonly items: HomeListFilterMenuAction[];
};

export interface HomeListFilterMenu {
  readonly title: string;
  readonly items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu>;
}

export function buildHomeListFilterMenu(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly showHiddenProjects: boolean;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly onShowHiddenProjectsChange: (show: boolean) => void;
}): HomeListFilterMenu {
  const items: Array<HomeListFilterMenuAction | HomeListFilterMenuSubmenu> = [];

  items.push({
    type: "submenu",
    title: "Environment",
    items: [
      {
        type: "action",
        title: "All environments",
        subtitle: "Show threads from every environment",
        state: props.selectedEnvironmentId === null ? "on" : "off",
        onPress: () => props.onEnvironmentChange(null),
      },
      ...props.environments.map((environment) => ({
        type: "action" as const,
        title: environment.label,
        state:
          props.selectedEnvironmentId === environment.environmentId
            ? ("on" as const)
            : ("off" as const),
        onPress: () => props.onEnvironmentChange(environment.environmentId),
      })),
    ],
  });

  if (props.projects.length > 0) {
    items.push({
      type: "submenu",
      title: "Project",
      items: [
        {
          type: "action",
          title: "All projects",
          subtitle: "Show threads from every project",
          state: props.selectedProjectKey === null ? "on" : "off",
          onPress: () => props.onProjectChange(null),
        },
        ...props.projects.map((project) => ({
          type: "action" as const,
          title: project.label,
          ...(project.hidden ? { subtitle: HIDDEN_PROJECT_LABEL } : {}),
          state: props.selectedProjectKey === project.key ? ("on" as const) : ("off" as const),
          onPress: () => props.onProjectChange(project.key),
        })),
        ...(props.projects.some((project) => project.hidden)
          ? [
              {
                type: "action" as const,
                title: SHOW_HIDDEN_PROJECTS_TITLE,
                subtitle: SHOW_HIDDEN_PROJECTS_SUBTITLE,
                state: props.showHiddenProjects ? ("on" as const) : ("off" as const),
                onPress: () => props.onShowHiddenProjectsChange(!props.showHiddenProjects),
              },
            ]
          : []),
      ],
    });
  }

  return {
    title: "Thread list options",
    items,
  };
}
