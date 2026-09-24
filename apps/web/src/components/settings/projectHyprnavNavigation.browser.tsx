import "../../index.css";

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { projectHyprnavSettingsRoute } from "./projectHyprnavNavigation";
import { retainSettingsScope, validateSettingsRouteSearch } from "./settingsScopeNavigation";
import { SETTINGS_NAV_ITEMS } from "./SettingsSidebarNav";

const projectTarget = { projectKey: "github.com/t3tools/t3code" };
const checkoutTarget = {
  projectKey: "github.com/t3tools/t3code",
  checkout: {
    environmentId: EnvironmentId.make("remote"),
    physicalProjectKey: "remote:/srv/t3code",
  },
};

function SettingsLocation() {
  const location = useLocation();
  const search = location.search as Record<string, unknown>;
  return (
    <output aria-label="Settings location">
      {[
        location.pathname,
        `project=${String(search.project ?? "")}`,
        `machine=${String(search.machine ?? "")}`,
        `checkout=${String(search.checkout ?? "")}`,
        `hash=${location.hash}`,
      ].join(" ")}
    </output>
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
      <button
        type="button"
        onClick={() => void router.navigate(projectHyprnavSettingsRoute(projectTarget))}
      >
        Project Hyprnav
      </button>
      <button
        type="button"
        onClick={() => void router.navigate(projectHyprnavSettingsRoute(checkoutTarget))}
      >
        Checkout Hyprnav
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
  // Mirrors the real settings layout's search validation and scope retention.
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    validateSearch: validateSettingsRouteSearch,
    search: { middlewares: [retainSettingsScope] },
    component: () => <Outlet />,
  });
  const defaultsRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: "/hyprnav",
    component: SettingsLocation,
  });
  const projectsRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: "/projects",
    component: SettingsLocation,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      settingsRoute.addChildren([defaultsRoute, projectsRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("project Hyprnav navigation", () => {
  it("routes the settings navigation item to device-local Hyprnav defaults", async () => {
    await renderNavigationHarness();
    await page.getByRole("button", { name: "Hyprnav defaults" }).click();
    await expect
      .element(page.getByLabelText("Settings location"))
      .toHaveTextContent("/settings/hyprnav project= machine= checkout=");
  });

  it("routes a project to its Hyprnav section at project scope", async () => {
    await renderNavigationHarness();
    await page.getByRole("button", { name: "Project Hyprnav" }).click();
    await expect
      .element(page.getByLabelText("Settings location"))
      .toHaveTextContent(
        "/settings/projects project=github.com/t3tools/t3code machine= checkout= hash=project-hyprnav",
      );
  });

  it("routes a checkout without losing environment identity", async () => {
    await renderNavigationHarness();
    await page.getByRole("button", { name: "Checkout Hyprnav" }).click();
    await expect
      .element(page.getByLabelText("Settings location"))
      .toHaveTextContent(
        "/settings/projects project=github.com/t3tools/t3code machine=remote checkout=remote:/srv/t3code hash=project-hyprnav",
      );
  });

  it("replaces a retained checkout when the project scope is requested", async () => {
    await renderNavigationHarness();
    await page.getByRole("button", { name: "Checkout Hyprnav" }).click();
    await expect
      .element(page.getByLabelText("Settings location"))
      .toHaveTextContent("checkout=remote:/srv/t3code");
    await page.getByRole("button", { name: "Project Hyprnav" }).click();
    await expect
      .element(page.getByLabelText("Settings location"))
      .toHaveTextContent("project=github.com/t3tools/t3code machine= checkout= hash=");
  });
});
