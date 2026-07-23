import "../index.css";

import type { ResolvedKeybindingsConfig } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { useState } from "react";
import { render } from "vitest-browser-react";

import { useChatScopedShortcuts } from "./useChatScopedShortcuts";

const KEYBINDINGS: ResolvedKeybindingsConfig = [
  {
    command: "chat.composer.focus",
    shortcut: {
      key: "s",
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      modKey: true,
    },
    whenAst: { type: "not", node: { type: "identifier", name: "terminalFocus" } },
  },
  {
    command: "thread.interrupt",
    shortcut: {
      key: "c",
      metaKey: false,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
      modKey: true,
    },
    whenAst: { type: "not", node: { type: "identifier", name: "terminalFocus" } },
  },
];
const PREVIEW_SCOPED_KEYBINDINGS: ResolvedKeybindingsConfig = [
  {
    ...KEYBINDINGS[0]!,
    whenAst: {
      type: "and",
      left: { type: "identifier", name: "previewFocus" },
      right: { type: "identifier", name: "previewOpen" },
    },
  },
];
const NON_PREVIEW_KEYBINDINGS: ResolvedKeybindingsConfig = [
  {
    ...KEYBINDINGS[0]!,
    whenAst: { type: "not", node: { type: "identifier", name: "previewFocus" } },
  },
];

function Harness(props: {
  running?: boolean;
  commandSurfaceOpen?: boolean;
  modelPickerOpen?: boolean;
  previewFocus?: boolean;
  previewOpen?: boolean;
  keybindings?: ResolvedKeybindingsConfig;
  onInterrupt: () => void;
}) {
  const [focused, setFocused] = useState(false);
  useChatScopedShortcuts({
    enabled: true,
    keybindings: props.keybindings ?? KEYBINDINGS,
    sessionStatus: props.running ? "running" : "ready",
    getHasComposer: () => true,
    getShortcutContext: () => ({
      terminalFocus: document.activeElement?.closest("[data-terminal-owner]") !== null,
      modelPickerOpen: props.modelPickerOpen ?? false,
      previewFocus: props.previewFocus ?? false,
      previewOpen: props.previewOpen ?? false,
    }),
    onFocusComposer: () => setFocused(true),
    onInterruptTurn: props.onInterrupt,
  });
  return (
    <>
      <button type="button">Outside</button>
      <div data-terminal-owner="drawer">
        <button type="button">Terminal</button>
      </div>
      {props.commandSurfaceOpen ? <div data-command-surface="command-palette" /> : null}
      <output aria-label="composer focused">{String(focused)}</output>
    </>
  );
}

describe("chat-scoped shortcuts", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("focuses the composer with Mod+S", async () => {
    const screen = await render(<Harness onInterrupt={vi.fn()} />);
    try {
      await page.getByRole("button", { name: "Outside" }).click();
      await userEvent.keyboard("{Control>}s{/Control}");
      await expect.element(page.getByLabelText("composer focused")).toHaveTextContent("true");
    } finally {
      await screen.unmount();
    }
  });

  it("interrupts a running turn once and consumes repeats", async () => {
    const onInterrupt = vi.fn();
    const screen = await render(<Harness running onInterrupt={onInterrupt} />);
    try {
      const initial = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      const repeated = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        shiftKey: true,
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      expect(window.dispatchEvent(initial)).toBe(false);
      expect(window.dispatchEvent(repeated)).toBe(false);
      expect(onInterrupt).toHaveBeenCalledTimes(1);
    } finally {
      await screen.unmount();
    }
  });

  it("does not consume interrupt while idle", async () => {
    const onInterrupt = vi.fn();
    const screen = await render(<Harness onInterrupt={onInterrupt} />);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      expect(window.dispatchEvent(event)).toBe(true);
      expect(onInterrupt).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("leaves terminal focus in control", async () => {
    const onInterrupt = vi.fn();
    const screen = await render(<Harness running onInterrupt={onInterrupt} />);
    try {
      await page.getByRole("button", { name: "Terminal" }).click();
      await userEvent.keyboard("{Control>}s{/Control}");
      await userEvent.keyboard("{Control>}{Shift>}c{/Shift}{/Control}");
      await expect.element(page.getByLabelText("composer focused")).toHaveTextContent("false");
      expect(onInterrupt).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("leaves an open command surface in control", async () => {
    const onInterrupt = vi.fn();
    const screen = await render(<Harness running commandSurfaceOpen onInterrupt={onInterrupt} />);
    try {
      await page.getByRole("button", { name: "Outside" }).click();
      await userEvent.keyboard("{Control>}s{/Control}");
      await userEvent.keyboard("{Control>}{Shift>}c{/Shift}{/Control}");
      await expect.element(page.getByLabelText("composer focused")).toHaveTextContent("false");
      expect(onInterrupt).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("does not handle an event already prevented by another owner", async () => {
    const onInterrupt = vi.fn();
    const screen = await render(<Harness running onInterrupt={onInterrupt} />);
    try {
      const event = new KeyboardEvent("keydown", {
        key: "c",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      event.preventDefault();
      expect(window.dispatchEvent(event)).toBe(false);
      expect(onInterrupt).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("leaves the composer model picker in control", async () => {
    const onInterrupt = vi.fn();
    const screen = await render(<Harness running modelPickerOpen onInterrupt={onInterrupt} />);
    try {
      await userEvent.keyboard("{Control>}s{/Control}");
      await userEvent.keyboard("{Control>}{Shift>}c{/Shift}{/Control}");
      await expect.element(page.getByLabelText("composer focused")).toHaveTextContent("false");
      expect(onInterrupt).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });

  it("honors custom preview-scoped bindings with live preview context", async () => {
    const screen = await render(
      <Harness
        keybindings={PREVIEW_SCOPED_KEYBINDINGS}
        previewFocus
        previewOpen
        onInterrupt={vi.fn()}
      />,
    );
    try {
      await userEvent.keyboard("{Control>}s{/Control}");
      await expect.element(page.getByLabelText("composer focused")).toHaveTextContent("true");
    } finally {
      await screen.unmount();
    }
  });

  it("does not fire a custom non-preview binding while preview owns focus", async () => {
    const screen = await render(
      <Harness keybindings={NON_PREVIEW_KEYBINDINGS} previewFocus onInterrupt={vi.fn()} />,
    );
    try {
      await userEvent.keyboard("{Control>}s{/Control}");
      await expect.element(page.getByLabelText("composer focused")).toHaveTextContent("false");
    } finally {
      await screen.unmount();
    }
  });
});
