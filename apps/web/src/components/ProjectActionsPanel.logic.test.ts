import type { ProjectScript, VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildProjectActionDescriptors,
  filterProjectActionGroups,
  resolveOpenProjectActionsShortcutDisposition,
} from "./ProjectActionsPanel.logic";

const SCRIPT: ProjectScript = {
  id: "verify",
  name: "Verify",
  command: "vp check",
  icon: "test",
  runOnWorktreeCreate: false,
  autoOpenPreview: false,
};

function status(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/panel",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

function build(overrides: Partial<Parameters<typeof buildProjectActionDescriptors>[0]> = {}) {
  return buildProjectActionDescriptors({
    scripts: [SCRIPT],
    gitCwd: "/repo",
    gitStatus: status(),
    gitStatusPending: false,
    gitStatusError: null,
    gitActionRunning: false,
    openInTargets: [{ label: "VS Code", value: "vscode" }],
    ...overrides,
  });
}

describe("project action descriptors", () => {
  it("builds configured actions and open targets with stable intents", () => {
    const descriptors = build();
    expect(descriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "script:verify",
          shortcutCommand: "script.verify.run",
          intent: { kind: "run-script", scriptId: "verify" },
        }),
        expect.objectContaining({
          id: "open-in:vscode",
          intent: { kind: "open-in", editor: "vscode" },
        }),
      ]),
    );
  });

  it("shows initialize for a non-repository", () => {
    expect(build({ gitStatus: status({ isRepo: false }) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "git:init", intent: { kind: "git", action: "init" } }),
      ]),
    );
  });

  it("replaces repository initialization with a busy row while it runs", () => {
    expect(
      build({ gitStatus: status({ isRepo: false }), gitActionRunning: true }).filter(
        (item) => item.group === "source-control",
      ),
    ).toEqual([expect.objectContaining({ title: "Initializing Git...", selectable: false })]);
  });

  it("shows commit for changes without duplicating the recommended action", () => {
    const sourceControl = build({
      gitStatus: status({ hasWorkingTreeChanges: true }),
    }).filter((item) => item.group === "source-control");
    expect(sourceControl.filter((item) => item.title === "Commit, push & PR")).toHaveLength(1);
    expect(sourceControl).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "git:commit", intent: { kind: "git", action: "commit" } }),
      ]),
    );
  });

  it.each([
    ["ahead", { aheadCount: 2 }, "Push & create PR"],
    ["behind", { behindCount: 2 }, "Pull"],
    [
      "diverged",
      { aheadCount: 1, behindCount: 1 },
      "Branch has diverged from upstream. Rebase/merge first.",
    ],
    ["no upstream", { hasUpstream: false, aheadCount: 1 }, "Push & create PR"],
    ["default ref", { isDefaultRef: true, aheadCount: 1 }, "Push"],
  ])("handles %s repository state", (_name, overrides, expectedTitle) => {
    expect(
      build({ gitStatus: status(overrides) })
        .filter((item) => item.group === "source-control")
        .map((item) => item.title),
    ).toContain(expectedTitle);
  });

  it("shows publish without unavailable remote actions", () => {
    const sourceControl = build({
      gitStatus: status({ hasPrimaryRemote: false, hasUpstream: false }),
    }).filter((item) => item.group === "source-control");
    expect(sourceControl.filter((item) => item.intent.kind === "git")).toEqual([
      expect.objectContaining({ intent: { kind: "git", action: "publish" } }),
    ]);
    expect(sourceControl.some((item) => item.title === "Push")).toBe(false);
  });

  it("reports a detached ref instead of claiming source control is synchronized", () => {
    expect(
      build({ gitStatus: status({ refName: null }) })
        .filter((item) => item.group === "source-control")
        .map((item) => item.title),
    ).toEqual(["Create and checkout a ref before pushing or opening a pull request."]);
  });

  it("shows an open pull request action", () => {
    const sourceControl = build({
      gitStatus: status({
        pr: {
          number: 4,
          title: "Panel",
          url: "https://example.com/pr/4",
          baseRef: "main",
          headRef: "feature/panel",
          state: "open",
        },
      }),
    }).filter((item) => item.group === "source-control");
    expect(sourceControl).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ intent: { kind: "git", action: "open_pr" } }),
      ]),
    );
  });

  it("replaces unavailable actions with one loading or error row", () => {
    const loading = build({ gitStatus: null, gitStatusPending: true });
    const failed = build({ gitStatus: null, gitStatusError: "Connection lost" });
    expect(loading.filter((item) => item.group === "source-control")).toEqual([
      expect.objectContaining({ title: "Checking source control status...", selectable: false }),
    ]);
    expect(failed.filter((item) => item.group === "source-control")).toEqual([
      expect.objectContaining({ title: "Source control unavailable", selectable: false }),
    ]);
  });

  it("filters by aliases and preserves group order", () => {
    const groups = filterProjectActionGroups(
      build({ gitStatus: status({ hasWorkingTreeChanges: true }) }),
      "pull request",
    );
    expect(groups.map((group) => group.id)).toEqual(["source-control"]);
    expect(filterProjectActionGroups(build(), "").map((group) => group.id)).toEqual([
      "project-actions",
      "source-control",
      "open-in",
    ]);
  });
});

describe("open project action shortcut disposition", () => {
  it("closes for its toggle and blocks other resolved global shortcuts", () => {
    expect(resolveOpenProjectActionsShortcutDisposition("projectActions.toggle")).toBe("close");
    expect(resolveOpenProjectActionsShortcutDisposition("editor.openFavorite")).toBe("block");
    expect(resolveOpenProjectActionsShortcutDisposition(null)).toBe("ignore");
  });
});
