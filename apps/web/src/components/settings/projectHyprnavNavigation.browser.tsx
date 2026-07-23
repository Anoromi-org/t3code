import "../../index.css";

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import {
  ProjectHyprnavSettingsButton,
  projectHyprnavSettingsRoute,
} from "./projectHyprnavNavigation";
import { SETTINGS_NAV_ITEMS } from "./SettingsSidebarNav";

const sidebarTarget = {
  environmentId: EnvironmentId.make("local"),
  projectId: ProjectId.make("project-one"),
};
const legacyTarget = {
  environmentId: EnvironmentId.make("remote"),
  projectId: ProjectId.make("project-two"),
};

function ScopedSettingsTarget() {
  const params = useParams({ strict: false });
  return (
    <output aria-label="Scoped Hyprnav target">{`${params.environmentId}:${params.projectId}`}</output>
  );
}

function NavigationHarness() {
  const router = useRouter();
  const defaultsItem = SETTINGS_NAV_ITEMS.find((item) => item.to === "/settings/hyprnav")!;
  return (
    <>
      <button type="button" onClick={() => void router.navigate({ to: defaultsItem.to })}>
        Hyprnav defaults
      </button>
      <ProjectHyprnavSettingsButton target={sidebarTarget} />
      <button
        type="button"
        onClick={() => void router.navigate(projectHyprnavSettingsRoute(legacyTarget))}
      >
        Legacy Hyprnav settings
      </button>
      <Outlet />
    </>
  );
}

async function renderNavigationHarness() {
  const rootRoute = createRootRoute({ component: NavigationHarness });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });
  const defaultsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/hyprnav",
    component: () => <output aria-label="Hyprnav defaults route">Defaults</output>,
  });
  const scopedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/projects/$environmentId/$projectId",
    component: ScopedSettingsTarget,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, defaultsRoute, scopedRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("project Hyprnav navigation", () => {
  it("routes the settings navigation item to Hyprnav defaults", async () => {
    await renderNavigationHarness();
    await page.getByRole("button", { name: "Hyprnav defaults" }).click();
    await expect.element(page.getByLabelText("Hyprnav defaults route")).toBeVisible();
  });

  it("routes sidebar-v2 project settings to the scoped project", async () => {
    await renderNavigationHarness();
    await page.getByRole("button", { name: "Configure" }).click();
    await expect
      .element(page.getByLabelText("Scoped Hyprnav target"))
      .toHaveTextContent("local:project-one");
  });

  it("routes the legacy context action without losing environment identity", async () => {
    await renderNavigationHarness();
    await page.getByRole("button", { name: "Legacy Hyprnav settings" }).click();
    await expect
      .element(page.getByLabelText("Scoped Hyprnav target"))
      .toHaveTextContent("remote:project-two");
  });
});
