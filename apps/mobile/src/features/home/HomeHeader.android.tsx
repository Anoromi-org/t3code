import type { MenuAction } from "@react-native-menu/menu";
import { useCallback, useMemo } from "react";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { ThreadListToolbar } from "./ThreadListToolbar";
import type { HomeHeaderProps } from "./HomeHeader.types";
import { HIDDEN_PROJECT_LABEL } from "./hidden-projects";
import {
  SHOW_HIDDEN_PROJECTS_ACTION_ID,
  SHOW_HIDDEN_PROJECTS_SUBTITLE,
  SHOW_HIDDEN_PROJECTS_TITLE,
} from "./home-list-filter-menu";

export type { HomeHeaderEnvironment } from "./HomeHeader.types";

function checkedMenuState(checked: boolean) {
  return checked ? ("on" as const) : undefined;
}

export function HomeHeader(props: HomeHeaderProps) {
  const hasCustomListOptions =
    props.selectedEnvironmentId !== null || props.selectedProjectKey !== null;
  const menuActions = useMemo<MenuAction[]>(
    () => [
      {
        id: "environment",
        title: "Environment",
        subactions: [
          {
            id: "environment:all",
            title: "All environments",
            state: checkedMenuState(props.selectedEnvironmentId === null),
          },
          ...props.environments.map((environment) => ({
            id: `environment:${environment.environmentId}`,
            title: environment.label,
            state: checkedMenuState(props.selectedEnvironmentId === environment.environmentId),
          })),
        ],
      },
      ...(props.projects.length === 0
        ? []
        : ([
            {
              id: "project",
              title: "Project",
              subactions: [
                {
                  id: "project:all",
                  title: "All projects",
                  state: checkedMenuState(props.selectedProjectKey === null),
                },
                ...props.projects.map((project) => ({
                  id: `project:${project.key}`,
                  title: project.label,
                  ...(project.hidden ? { subtitle: HIDDEN_PROJECT_LABEL } : {}),
                  state: checkedMenuState(props.selectedProjectKey === project.key),
                })),
                ...(props.projects.some((project) => project.hidden)
                  ? [
                      {
                        id: SHOW_HIDDEN_PROJECTS_ACTION_ID,
                        title: SHOW_HIDDEN_PROJECTS_TITLE,
                        subtitle: SHOW_HIDDEN_PROJECTS_SUBTITLE,
                        state: checkedMenuState(props.showHiddenProjects),
                      },
                    ]
                  : []),
              ],
            },
          ] satisfies MenuAction[])),
    ],
    [
      props.environments,
      props.projects,
      props.selectedEnvironmentId,
      props.selectedProjectKey,
      props.showHiddenProjects,
    ],
  );
  const handleMenuAction = useCallback(
    (event: { nativeEvent: { event: string } }) => {
      const id = event.nativeEvent.event;
      if (id === "environment:all") {
        props.onEnvironmentChange(null);
        return;
      }

      if (id.startsWith("environment:")) {
        const environmentId = id.slice("environment:".length);
        const environment = props.environments.find(
          (candidate) => candidate.environmentId === environmentId,
        );
        if (environment) {
          props.onEnvironmentChange(environment.environmentId);
        }
        return;
      }

      if (id === SHOW_HIDDEN_PROJECTS_ACTION_ID) {
        props.onShowHiddenProjectsChange(!props.showHiddenProjects);
        return;
      }

      if (id === "project:all") {
        props.onProjectChange(null);
        return;
      }

      if (id.startsWith("project:")) {
        const projectKey = id.slice("project:".length);
        if (props.projects.some((project) => project.key === projectKey)) {
          props.onProjectChange(projectKey);
        }
        return;
      }
    },
    [props],
  );

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: false }} />
      <ThreadListToolbar
        searchQuery={props.searchQuery}
        onSearchQueryChange={props.onSearchQueryChange}
        filterActions={menuActions}
        filterCustomized={hasCustomListOptions}
        onFilterAction={handleMenuAction}
        onOpenSettings={props.onOpenSettings}
        onOpenEnvironments={props.onOpenEnvironments}
      />
    </>
  );
}
