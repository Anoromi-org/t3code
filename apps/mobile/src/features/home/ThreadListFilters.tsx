import { useGT, useMessages } from "gt-react-native";
import { Pressable, ScrollView } from "react-native";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import type { EnvironmentId } from "@t3tools/contracts";
import { hiddenProjectLabel } from "./hidden-projects";
import {
  SHOW_HIDDEN_PROJECTS_ACTION_ID,
  type HomeListFilterMenuEnvironment,
  type HomeListFilterMenuProject,
} from "./home-list-filter-menu";

export function ThreadListFilters(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly showHiddenProjects: boolean;
  readonly onShowHiddenProjectsChange: (show: boolean) => void;
  /** List padding the scroller bleeds through so pills start where row content does. */
  readonly gutter: number;
}) {
  const gt = useGT();
  const m = useMessages();
  const selectedEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  const selectedProject = props.projects.find(
    (project) => project.key === props.selectedProjectKey,
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginHorizontal: -props.gutter, overflow: "visible" }}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 2, paddingBottom: 10, gap: 8 }}
    >
      <ListFilterMenu
        label={selectedEnvironment?.label ?? gt("All environments")}
        accessibilityLabel={gt("Filter threads by environment")}
        active={selectedEnvironment !== undefined}
        actions={[
          {
            id: "all",
            title: gt("All environments"),
            state: props.selectedEnvironmentId === null ? "on" : "off",
          },
          ...props.environments.map((environment) => ({
            id: JSON.stringify(environment.environmentId),
            title: environment.label,
            state:
              environment.environmentId === props.selectedEnvironmentId
                ? ("on" as const)
                : ("off" as const),
          })),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onEnvironmentChange(null);
          else {
            const environment = props.environments.find(
              (candidate) => JSON.stringify(candidate.environmentId) === id,
            );
            if (environment) props.onEnvironmentChange(environment.environmentId);
          }
        }}
      />
      <ListFilterMenu
        label={selectedProject?.label ?? gt("All projects")}
        accessibilityLabel={gt("Filter threads by project")}
        active={selectedProject !== undefined}
        actions={[
          {
            id: "all",
            title: gt("All projects"),
            state: props.selectedProjectKey === null ? "on" : "off",
          },
          ...props.projects.map((project) => ({
            id: JSON.stringify(project.key),
            title: project.label,
            ...(project.hidden ? { subtitle: hiddenProjectLabel(m) } : {}),
            state: project.key === props.selectedProjectKey ? ("on" as const) : ("off" as const),
          })),
          ...(props.projects.some((project) => project.hidden)
            ? [
                {
                  id: SHOW_HIDDEN_PROJECTS_ACTION_ID,
                  title: gt("Show hidden projects"),
                  subtitle: gt("Include them in the all-projects list"),
                  state: props.showHiddenProjects ? ("on" as const) : ("off" as const),
                },
              ]
            : []),
        ]}
        onSelect={(id) => {
          if (id === "all") props.onProjectChange(null);
          else if (id === SHOW_HIDDEN_PROJECTS_ACTION_ID) {
            props.onShowHiddenProjectsChange(!props.showHiddenProjects);
          } else {
            const project = props.projects.find(
              (candidate) => JSON.stringify(candidate.key) === id,
            );
            if (project) props.onProjectChange(project.key);
          }
        }}
      />
      {props.selectedEnvironmentId !== null || props.selectedProjectKey !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={gt("Reset thread filters")}
          className="h-8 w-8 items-center justify-center"
          onPress={() => {
            props.onEnvironmentChange(null);
            props.onProjectChange(null);
          }}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
