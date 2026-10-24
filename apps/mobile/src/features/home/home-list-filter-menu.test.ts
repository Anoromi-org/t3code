import { describe, expect, it, vi } from "vite-plus/test";

import { buildHomeListFilterMenu } from "./home-list-filter-menu";

describe("buildHomeListFilterMenu", () => {
  it("adds a project scope submenu that selects and clears the same scope as the chips", () => {
    const onProjectChange = vi.fn();
    const menu = buildHomeListFilterMenu({
      environments: [],
      projects: [
        { key: "environment-1:project-1", label: "Codething", hidden: false },
        { key: "environment-1:project-2", label: "Website", hidden: false },
      ],
      selectedEnvironmentId: null,
      selectedProjectKey: "environment-1:project-1",
      showHiddenProjects: false,
      onEnvironmentChange: vi.fn(),
      onProjectChange,
      onShowHiddenProjectsChange: vi.fn(),
    });

    const projectMenu = menu.items.find(
      (item) => item.type === "submenu" && item.title === "Project",
    );
    expect(menu.items.some((item) => item.title === "Settings")).toBe(false);
    expect(projectMenu).toMatchObject({
      type: "submenu",
      items: [
        { title: "All projects", state: "off" },
        { title: "Codething", state: "on" },
        { title: "Website", state: "off" },
      ],
    });
    if (projectMenu?.type !== "submenu") throw new Error("Expected project submenu");

    projectMenu.items[0]?.onPress();
    projectMenu.items[2]?.onPress();
    expect(onProjectChange).toHaveBeenNthCalledWith(1, null);
    expect(onProjectChange).toHaveBeenNthCalledWith(2, "environment-1:project-2");
  });

  it("marks hidden projects and offers the show-hidden toggle only when one exists", () => {
    const onShowHiddenProjectsChange = vi.fn();
    const build = (hidden: boolean) =>
      buildHomeListFilterMenu({
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
      }).items.find((item) => item.type === "submenu" && item.title === "Project");

    const withHidden = build(true);
    if (withHidden?.type !== "submenu") throw new Error("Expected project submenu");
    expect(withHidden.items[1]).not.toHaveProperty("subtitle");
    expect(withHidden.items).toMatchObject([
      { title: "All projects" },
      { title: "Codething" },
      { title: "Learning", subtitle: "Hidden", state: "on" },
      { title: "Show hidden projects", state: "off" },
    ]);
    withHidden.items[3]?.onPress();
    expect(onShowHiddenProjectsChange).toHaveBeenCalledWith(true);

    const withoutHidden = build(false);
    if (withoutHidden?.type !== "submenu") throw new Error("Expected project submenu");
    expect(withoutHidden.items.map((item) => item.title)).not.toContain("Show hidden projects");
  });
});
