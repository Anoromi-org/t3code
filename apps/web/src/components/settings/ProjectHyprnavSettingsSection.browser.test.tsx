import "../../index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import {
  DEFAULT_PROJECT_HYPRNAV_SETTINGS,
  EnvironmentId,
  ProjectId,
  type ProjectHyprnavOverride,
} from "@t3tools/contracts";
import { type ClientSettings, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKey,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import type { SidebarProjectGroupMember } from "../../sidebarProjectGrouping";
import type { Project } from "../../types";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("environment-remote");

const state = vi.hoisted(() => ({
  client: null as unknown as ClientSettings,
  projects: [] as Project[],
  updateProject: vi.fn(),
  persistClientSettings: vi.fn(),
  selectScope: vi.fn(),
}));

vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  useClientSettings: (selector?: (settings: ClientSettings) => unknown) =>
    selector ? selector(state.client) : state.client,
  useClientSettingsHydrated: () => true,
  persistClientSettingsPatchUpdate: state.persistClientSettings,
}));
vi.mock("../../state/environments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/environments")>()),
  usePrimaryEnvironment: () => ({ environmentId: LOCAL_ENVIRONMENT_ID }),
}));
vi.mock("../../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/entities")>()),
  useProjects: () => state.projects,
  useThreadShells: () => [],
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => state.updateProject,
}));
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => [],
}));
vi.mock("../../editorPreferences", () => ({ resolveAndPersistPreferredEditor: () => null }));
vi.mock("./SettingsScopeContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./SettingsScopeContext")>()),
  useOptionalSettingsScope: () => ({
    scope: { kind: "project", environmentIds: [] },
    targets: [],
    connectedEnvironments: [],
    environments: [],
    groups: [],
    search: {},
    selectScope: state.selectScope,
  }),
}));

import { ProjectHyprnavSettingsSection } from "./ProjectHyprnavSettingsPanel";

function makeMember(input: {
  environmentId: EnvironmentId;
  projectId: string;
  workspaceRoot: string;
  environmentLabel: string;
}): SidebarProjectGroupMember {
  const project: Project = {
    id: ProjectId.make(input.projectId),
    environmentId: input.environmentId,
    title: "t3code",
    workspaceRoot: input.workspaceRoot,
    repositoryIdentity: {
      canonicalKey: "github.com/t3tools/t3code",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/t3tools/t3code.git",
      },
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };
  return {
    ...project,
    physicalProjectKey: derivePhysicalProjectKey(project),
    environmentLabel: input.environmentLabel,
  };
}

const localMember = makeMember({
  environmentId: LOCAL_ENVIRONMENT_ID,
  projectId: "project-local",
  workspaceRoot: "/home/me/t3code",
  environmentLabel: "This machine",
});
const remoteMember = makeMember({
  environmentId: REMOTE_ENVIRONMENT_ID,
  projectId: "project-remote",
  workspaceRoot: "/srv/t3code",
  environmentLabel: "Build box",
});

function logicalProjectKey(client: ClientSettings = state.client) {
  return deriveLogicalProjectKeyFromSettings(localMember, selectProjectGroupingSettings(client));
}

function savedOverrides() {
  return state.updateProject.mock.calls.map((args) => {
    const call = args[0] as { input: { projectId: string; hyprnav: ProjectHyprnavOverride } };
    return {
      projectId: call.input.projectId,
      slots: call.input.hyprnav?.bindings.map((binding) => binding.slot) ?? null,
    };
  });
}

async function removeFirstBindingAndSave() {
  const firstBinding = DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings[0]!;
  await page.getByRole("button", { name: `Remove ${firstBinding.id}` }).click();
  await page.getByRole("button", { name: "Save and apply" }).click();
}

const expectedSlots = DEFAULT_PROJECT_HYPRNAV_SETTINGS.bindings.slice(1).map(({ slot }) => slot);

function renderSection(
  members: ReadonlyArray<SidebarProjectGroupMember>,
  client: ClientSettings = DEFAULT_CLIENT_SETTINGS,
) {
  state.client = client;
  state.projects = [localMember, remoteMember];
  state.updateProject.mockReset();
  state.updateProject.mockResolvedValue({ _tag: "Success", value: undefined });
  state.persistClientSettings.mockReset();
  state.persistClientSettings.mockResolvedValue(undefined);
  state.selectScope.mockReset();
  return render(<ProjectHyprnavSettingsSection projectKey="t3code" members={members} />);
}

function separateModeSettings(): ClientSettings {
  return {
    ...DEFAULT_CLIENT_SETTINGS,
    groupedProjectHyprnavStateByLogicalProjectKey: {
      [logicalProjectKey(DEFAULT_CLIENT_SETTINGS)]: { mode: "separate" },
    },
  };
}

describe("ProjectHyprnavSettingsSection", () => {
  it("saves shared bindings to every grouped checkout at project scope", async () => {
    await using _screen = await renderSection([localMember, remoteMember]);

    await expect.element(page.getByText("Shared with 1 other grouped checkout.")).toBeVisible();
    await expect.element(page.getByText("Using device defaults")).toBeVisible();
    await removeFirstBindingAndSave();

    await expect.poll(() => state.updateProject.mock.calls.length).toBe(2);
    // Remote entries update first so the primary project changes last.
    expect(savedOverrides()).toEqual([
      { projectId: remoteMember.id, slots: expectedSlots },
      { projectId: localMember.id, slots: expectedSlots },
    ]);
  });

  it("lists checkouts in separate mode and opens the chosen checkout scope", async () => {
    await using _screen = await renderSection([localMember, remoteMember], separateModeSettings());

    await expect
      .element(page.getByRole("button", { name: "Save and apply" }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "Edit Hyprnav bindings for /srv/t3code" }).click();
    expect(state.selectScope).toHaveBeenCalledExactlyOnceWith({
      project: "t3code",
      machine: REMOTE_ENVIRONMENT_ID,
      checkout: remoteMember.physicalProjectKey,
    });
  });

  it("saves only the selected checkout in separate mode", async () => {
    await using _screen = await renderSection([remoteMember], separateModeSettings());

    await expect.element(page.getByText("Applies to /srv/t3code only.")).toBeVisible();
    await removeFirstBindingAndSave();

    await expect.poll(() => state.updateProject.mock.calls.length).toBe(1);
    expect(savedOverrides()).toEqual([{ projectId: remoteMember.id, slots: expectedSlots }]);
  });

  it("switches a grouped project to shared settings from checkout scope", async () => {
    await using _screen = await renderSection([remoteMember], separateModeSettings());

    await page.getByRole("combobox", { name: "Project Hyprnav editing mode" }).click();
    await page.getByRole("option", { name: "Same settings" }).click();

    await expect.poll(() => state.persistClientSettings.mock.calls.length).toBe(1);
    const update = state.persistClientSettings.mock.calls[0]?.[0] as (
      settings: ClientSettings,
    ) => Partial<ClientSettings>;
    expect(
      update(state.client).groupedProjectHyprnavStateByLogicalProjectKey?.[logicalProjectKey()],
    ).toMatchObject({ mode: "same", defaultProjectKey: localMember.physicalProjectKey });
    // Same mode first converges every member onto the shared (primary) settings.
    expect(state.updateProject).toHaveBeenCalledTimes(2);
  });
});
