import "../../index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import type { ProjectHyprnavSettings } from "@t3tools/contracts";
import { DEFAULT_PROJECT_HYPRNAV_SETTINGS } from "@t3tools/contracts";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { HyprnavEditor } from "./ProjectHyprnavSettingsPanel";

async function renderWithRouter(content: ReactNode) {
  const rootRoute = createRootRoute({ component: () => content });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function SaveBusyHarness({ onSave }: { readonly onSave: () => Promise<string> }) {
  const [busy, setBusy] = useState(false);
  return (
    <HyprnavEditor
      title="Project"
      description="Project bindings"
      initialSettings={{ bindings: [] }}
      inherited={false}
      disabled={false}
      context={
        <button type="button" disabled={busy}>
          Editing mode
        </button>
      }
      onBusyChange={setBusy}
      onReset={null}
      onSave={onSave}
    />
  );
}

describe("HyprnavEditor browser", () => {
  it("renders bindings, validates edits, adds rows, and saves the parsed settings", async () => {
    const onSave = vi.fn(async (_settings: ProjectHyprnavSettings) => "Saved and synchronized.");
    await renderWithRouter(
      <HyprnavEditor
        title="Hyprnav defaults"
        description="Keyboard navigation bindings"
        initialSettings={{
          bindings: [
            {
              id: "notify",
              slot: 3,
              scope: "thread",
              workspace: { mode: "managed" },
              action: "shell-command",
              command: "",
            },
          ],
        }}
        inherited={false}
        disabled={false}
        onReset={null}
        onSave={onSave}
      />,
    );

    await expect.element(page.getByRole("heading", { name: "Hyprnav defaults" })).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Name for notify" }))
      .toHaveAttribute("maxlength", "255");
    const save = page.getByRole("button", { name: "Save and apply" });
    await expect.element(save).toBeDisabled();
    await expect.element(page.getByText("Shell command bindings need a command.")).toBeVisible();

    await page.getByRole("textbox", { name: "Command for notify" }).fill("notify-send ready");
    await expect.element(save).toBeEnabled();
    await save.click();
    await expect.poll(() => onSave.mock.calls.length).toBe(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      bindings: [
        {
          id: "notify",
          slot: 3,
          scope: "thread",
          workspace: { mode: "managed" },
          action: "shell-command",
          command: "notify-send ready",
        },
      ],
    });
    await expect.element(page.getByText("Saved and synchronized.")).toBeVisible();

    await page.getByRole("button", { name: "Add binding" }).click();
    await expect.element(page.getByRole("button", { name: /Remove custom-/ })).toBeVisible();
  });

  it("resets an inherited project and surfaces unavailable-runtime status", async () => {
    const onReset = vi.fn(async () => "Saved, but the Hyprnav desktop runtime is unavailable.");
    await renderWithRouter(
      <HyprnavEditor
        title="Project"
        description="Project bindings"
        initialSettings={{ bindings: [] }}
        inherited
        disabled={false}
        resetSettings={DEFAULT_PROJECT_HYPRNAV_SETTINGS}
        onReset={onReset}
        onSave={async () => "Saved."}
      />,
    );

    await expect.element(page.getByText("Using global defaults")).toBeVisible();
    await page.getByRole("button", { name: "Use defaults" }).click();
    await expect.poll(() => onReset.mock.calls.length).toBe(1);
    await expect
      .element(page.getByRole("button", { name: "Remove worktree-terminal" }))
      .toBeVisible();
    await expect
      .element(page.getByText("Saved, but the Hyprnav desktop runtime is unavailable."))
      .toBeVisible();
  });

  it("preserves unsaved drafts across projection and settings-source refreshes", async () => {
    const initialSettings: ProjectHyprnavSettings = {
      bindings: [
        {
          id: "notify",
          slot: 3,
          scope: "thread",
          workspace: { mode: "managed" },
          action: "shell-command",
          command: "notify-send old",
        },
      ],
    };
    function RefreshHarness() {
      const [refreshed, setRefreshed] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setRefreshed(true)}>
            Refresh projection
          </button>
          <HyprnavEditor
            title={refreshed ? "Project refreshed" : "Project"}
            description="Project bindings"
            initialSettings={
              refreshed
                ? {
                    bindings: initialSettings.bindings.map((binding) => ({
                      ...binding,
                      command: "notify-send server-refresh",
                    })),
                  }
                : initialSettings
            }
            inherited={false}
            disabled={false}
            onReset={null}
            onSave={async () => "Saved."}
          />
        </>
      );
    }
    await renderWithRouter(<RefreshHarness />);
    const command = page.getByRole("textbox", { name: "Command for notify" });
    await command.fill("notify-send unsaved");

    await page.getByRole("button", { name: "Refresh projection" }).click();

    await expect.element(command).toHaveValue("notify-send unsaved");
  });

  it("blocks grouped editing mode changes while a save is pending", async () => {
    let resolveSave: ((status: string) => void) | undefined;
    const pendingSave = new Promise<string>((resolve) => {
      resolveSave = resolve;
    });
    await renderWithRouter(<SaveBusyHarness onSave={() => pendingSave} />);
    const editingMode = page.getByRole("button", { name: "Editing mode" });

    await page.getByRole("button", { name: "Save and apply" }).click();
    await expect.element(editingMode).toBeDisabled();

    resolveSave?.("Saved.");
    await expect.element(editingMode).toBeEnabled();
  });
});
