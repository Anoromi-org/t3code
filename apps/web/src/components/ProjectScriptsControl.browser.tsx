import "../index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";

import { commandForProjectScript } from "../projectScripts";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "./ProjectScriptsControl";

const success = { _tag: "Success", value: undefined } as ProjectScriptActionResult;

describe("ProjectScriptsControl browser", () => {
  it("submits a cleared shortcut when editing a project action", async () => {
    const onUpdateScript = vi.fn(
      async (_scriptId: string, _input: NewProjectScriptInput) => success,
    );
    const scriptId = "test";
    const command = commandForProjectScript(scriptId);

    await render(
      <ProjectScriptsControl
        scripts={[
          {
            id: scriptId,
            name: "Test",
            command: "vp test",
            icon: "test",
            runOnWorktreeCreate: false,
          },
        ]}
        keybindings={[
          {
            command,
            shortcut: {
              key: "k",
              metaKey: false,
              ctrlKey: false,
              shiftKey: false,
              altKey: false,
              modKey: true,
            },
          },
        ]}
        onRunScript={() => undefined}
        onAddScript={async () => success}
        onUpdateScript={onUpdateScript}
        onDeleteScript={async () => success}
      />,
    );

    await page.getByRole("button", { name: "Script actions" }).click();
    await page.getByRole("button", { name: "Edit Test" }).click();

    const shortcut = page.getByRole("textbox", { name: "Keybinding" });
    await expect.element(shortcut).toHaveValue("mod+k");
    await shortcut.click();
    await userEvent.keyboard("{Backspace}");
    await expect.element(shortcut).toHaveValue("");

    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => onUpdateScript.mock.calls.length).toBe(1);
    expect(onUpdateScript.mock.calls[0]?.[0]).toBe(scriptId);
    expect(onUpdateScript.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ keybinding: null }),
    );
  });
});
