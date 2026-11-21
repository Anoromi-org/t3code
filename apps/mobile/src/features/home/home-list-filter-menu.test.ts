import type { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import type { WorkspaceEnvironment } from "../../state/workspaceModel";
import { buildHomeListFilterMenuItems, homeListFilterEnvironments } from "./home-list-filter-menu";

function environment(
  environmentId: string,
  environmentLabel: string,
  isEnabled: boolean,
): WorkspaceEnvironment {
  return {
    environmentId: environmentId as EnvironmentId,
    environmentLabel,
    displayUrl: "",
    isRelayManaged: false,
    isEnabled,
    connectionState: isEnabled ? "connected" : "available",
    connectionError: null,
    connectionErrorTraceId: null,
  };
}

it("offers only switched-on environments, sorted by label", () => {
  expect(
    homeListFilterEnvironments([
      environment("env-studio", "Studio", true),
      environment("env-laptop", "Laptop", false),
      environment("env-desk", "Desk", true),
    ]),
  ).toEqual([
    { environmentId: "env-desk", label: "Desk", connectionState: "connected" },
    { environmentId: "env-studio", label: "Studio", connectionState: "connected" },
  ]);
});

it("marks hidden projects and offers the show-hidden toggle only when one exists", () => {
  const onShowHiddenProjectsChange = vi.fn();
  const build = (hidden: boolean) =>
    buildHomeListFilterMenuItems({
      environments: [],
      projects: [
        { key: "environment-1:project-1", label: "Codething", hidden: false },
        { key: "environment-1:project-2", label: "Learning", hidden },
      ],
      selectedEnvironmentId: null,
      selectedProjectKey: "environment-1:project-2",
      showHiddenProjects: false,
      onEnvironmentChange: vi.fn(),
      onProjectChange: vi.fn(),
      onShowHiddenProjectsChange,
    }).find((item) => item.id === "project");

  const withHidden = build(true);
  if (withHidden === undefined || !("items" in withHidden)) {
    throw new Error("Expected project submenu");
  }
  expect(withHidden.items[1]).not.toHaveProperty("subtitle");
  expect(withHidden.items).toMatchObject([
    { title: "All projects" },
    { title: "Codething" },
    { title: "Learning", subtitle: "Hidden", selected: true },
    { title: "Show hidden projects", selected: false },
  ]);
  const toggle = withHidden.items[3];
  if (toggle === undefined || !("onPress" in toggle)) throw new Error("Expected toggle action");
  toggle.onPress();
  expect(onShowHiddenProjectsChange).toHaveBeenCalledWith(true);

  const withoutHidden = build(false);
  if (withoutHidden === undefined || !("items" in withoutHidden)) {
    throw new Error("Expected project submenu");
  }
  expect(withoutHidden.items.map((item) => item.title)).not.toContain("Show hidden projects");
});
