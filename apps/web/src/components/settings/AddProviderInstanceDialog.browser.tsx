import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import { EnvironmentId } from "@t3tools/contracts";

const { persistSettings } = vi.hoisted(() => ({
  persistSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/useSettings")>();
  const { DEFAULT_UNIFIED_SETTINGS } = await vi.importActual<
    typeof import("@t3tools/contracts/settings")
  >("@t3tools/contracts/settings");
  return {
    ...actual,
    usePersistEnvironmentSettings: () => persistSettings,
    useEnvironmentSettings: () => DEFAULT_UNIFIED_SETTINGS,
  };
});

import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";

describe("AddProviderInstanceDialog", () => {
  afterEach(() => {
    persistSettings.mockReset();
    document.body.innerHTML = "";
  });

  it("keeps the dialog open when provider persistence fails", async () => {
    let rejectPersistence: ((error: Error) => void) | undefined;
    persistSettings.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectPersistence = reject;
        }),
    );
    const onOpenChange = vi.fn();
    await render(
      <AddProviderInstanceDialog
        open
        environmentId={EnvironmentId.make("primary")}
        environmentLabel="This machine"
        onOpenChange={onOpenChange}
      />,
    );

    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("textbox", { name: "Label" }).fill("Work");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Add instance" }).click();

    await expect.element(page.getByRole("button", { name: "Adding…" })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    rejectPersistence?.(new Error("disk full"));
    await expect.element(page.getByRole("button", { name: "Add instance" })).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
