import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHomeProjectFilterOptions,
  buildHomeProjectRowTitles,
  homeListHiddenProjectKeys,
} from "./hidden-projects";
import { buildHomeProjectScopes } from "./homeThreadList";

const environmentId = EnvironmentId.make("environment-1");

function makeProject(
  id: string,
  options: { readonly hidden?: boolean; readonly repositoryKey?: string } = {},
): EnvironmentProject {
  return {
    environmentId,
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/work/${id}`,
    repositoryIdentity: options.repositoryKey
      ? {
          canonicalKey: options.repositoryKey,
          locator: {
            source: "git-remote",
            remoteName: "origin",
            remoteUrl: `https://${options.repositoryKey}.git`,
          },
        }
      : null,
    defaultModelSelection: null,
    scripts: [],
    hidden: options.hidden ?? false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

const scopesOf = (projects: ReadonlyArray<EnvironmentProject>) =>
  buildHomeProjectScopes({ projects, environmentId: null, projectGroupingMode: "repository" });

describe("buildHomeProjectFilterOptions", () => {
  it("keeps hidden projects selectable after the visible ones", () => {
    const options = buildHomeProjectFilterOptions(
      scopesOf([makeProject("alpha", { hidden: true }), makeProject("beta"), makeProject("gamma")]),
    );

    expect(options.map(({ label, hidden }) => ({ label, hidden }))).toEqual([
      { label: "beta", hidden: false },
      { label: "gamma", hidden: false },
      { label: "alpha", hidden: true },
    ]);
  });

  it("treats a repository group as hidden only when every checkout is hidden", () => {
    const partlyHidden = buildHomeProjectFilterOptions(
      scopesOf([
        makeProject("app-main", { repositoryKey: "github.com/acme/app", hidden: true }),
        makeProject("app-feature", { repositoryKey: "github.com/acme/app" }),
      ]),
    );
    const fullyHidden = buildHomeProjectFilterOptions(
      scopesOf([
        makeProject("app-main", { repositoryKey: "github.com/acme/app", hidden: true }),
        makeProject("app-feature", { repositoryKey: "github.com/acme/app", hidden: true }),
      ]),
    );

    expect(partlyHidden).toHaveLength(1);
    expect(partlyHidden[0]?.hidden).toBe(false);
    expect(fullyHidden[0]?.hidden).toBe(true);
  });
});

describe("homeListHiddenProjectKeys", () => {
  const projects = [makeProject("learning", { hidden: true }), makeProject("app")];
  const base = { projects, showHiddenProjects: false, projectScoped: false, searchQuery: "" };

  it("leaves hidden projects out of the all-projects list by default", () => {
    expect([...homeListHiddenProjectKeys(base)]).toEqual(["environment-1:learning"]);
  });

  it("shows hidden projects when the toggle, a project filter, or a search asks for them", () => {
    expect(homeListHiddenProjectKeys({ ...base, showHiddenProjects: true }).size).toBe(0);
    expect(homeListHiddenProjectKeys({ ...base, projectScoped: true }).size).toBe(0);
    expect(homeListHiddenProjectKeys({ ...base, searchQuery: "lesson" }).size).toBe(0);
    expect(homeListHiddenProjectKeys({ ...base, searchQuery: "   " }).size).toBe(1);
  });
});

describe("buildHomeProjectRowTitles", () => {
  it("marks rows whose own checkout is hidden, even inside a visible group", () => {
    const titles = buildHomeProjectRowTitles(
      scopesOf([
        makeProject("app-main", { repositoryKey: "github.com/acme/app", hidden: true }),
        makeProject("app-feature", { repositoryKey: "github.com/acme/app" }),
      ]),
    );

    expect(titles.get("environment-1:app-main")).toMatch(/ · Hidden$/);
    expect(titles.get("environment-1:app-feature")).not.toMatch(/Hidden/);
  });
});
