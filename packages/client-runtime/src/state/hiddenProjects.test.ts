import { describe, expect, it } from "vite-plus/test";

import {
  excludeHiddenProjectItems,
  hiddenProjectKeys,
  isInHiddenProject,
  preferVisibleProjects,
} from "./hiddenProjects.ts";

const projects = [
  { environmentId: "local", id: "learning", hidden: true },
  { environmentId: "local", id: "app", hidden: false },
  { environmentId: "remote", id: "learning" },
];
const threads = [
  { id: "lesson", environmentId: "local", projectId: "learning" },
  { id: "feature", environmentId: "local", projectId: "app" },
  { id: "remote-lesson", environmentId: "remote", projectId: "learning" },
];

describe("hidden projects", () => {
  it("leaves out threads of hidden projects, per environment", () => {
    const keys = hiddenProjectKeys(projects, false);
    expect([...keys]).toEqual(["local:learning"]);
    expect(excludeHiddenProjectItems(threads, keys).map((thread) => thread.id)).toEqual([
      "feature",
      "remote-lesson",
    ]);
    expect(isInHiddenProject(threads[0]!, keys)).toBe(true);
  });

  it("shows everything when hidden projects are shown", () => {
    const keys = hiddenProjectKeys(projects, true);
    expect(keys.size).toBe(0);
    expect(excludeHiddenProjectItems(threads, keys)).toBe(threads);
  });

  it("keeps an item the user is looking at", () => {
    const keys = hiddenProjectKeys(projects, false);
    expect(
      excludeHiddenProjectItems(threads, keys, (thread) => thread.id === "lesson").map(
        (thread) => thread.id,
      ),
    ).toEqual(["lesson", "feature", "remote-lesson"]);
  });

  it("prefers visible projects for automatic choices", () => {
    expect(preferVisibleProjects(projects, false).map((project) => project.id)).toEqual([
      "app",
      "learning",
    ]);
    expect(preferVisibleProjects(projects, true)).toBe(projects);
    const onlyHidden = [projects[0]!];
    expect(preferVisibleProjects(onlyHidden, false)).toBe(onlyHidden);
  });
});
