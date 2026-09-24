import "../index.css";

import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "vitest-browser-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { DraftId } from "../composerDraftStore";
import type { RecentThreadTarget } from "../recentThreadStore";

vi.mock("./ThreadStatusIndicators", () => ({
  ThreadRowLeadingStatus: () => null,
  ThreadRowTrailingStatus: () => null,
}));

import { RecentThreadSwitcher } from "./RecentThreadSwitcher";
import type { RecentThreadSwitcherItem } from "./RecentThreadSwitcher.logic";

const threadTarget: RecentThreadTarget = {
  kind: "server",
  threadRef: {
    environmentId: EnvironmentId.make("environment-browser"),
    threadId: ThreadId.make("thread-browser"),
  },
};
const draftTarget: RecentThreadTarget = {
  kind: "draft",
  draftId: DraftId.make("draft-browser"),
};
const items: RecentThreadSwitcherItem[] = [
  {
    type: "thread",
    target: threadTarget,
    title: "Current thread",
    projectTitle: "Browser project",
    recencyAt: "2026-07-20T12:00:00.000Z",
    thread: {
      id: "thread-browser",
      environmentId: "environment-browser",
    } as EnvironmentThreadShell,
  },
  {
    type: "draft",
    target: draftTarget,
    projectTitle: "Draft project",
  },
];

describe("RecentThreadSwitcher", () => {
  it("renders the Ctrl+E-style list without search and updates its highlight", async () => {
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    const view = await render(
      <RecentThreadSwitcher
        open
        items={items}
        highlightedIndex={1}
        onCancel={onCancel}
        onSelect={onSelect}
      />,
    );

    await expect
      .element(page.getByRole("dialog", { name: "Recent thread switcher" }))
      .toBeInTheDocument();
    await expect.element(page.getByRole("searchbox")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("option", { name: /New thread/ }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByText("Draft", { exact: true })).toBeInTheDocument();

    await view.rerender(
      <RecentThreadSwitcher
        open
        items={items}
        highlightedIndex={0}
        onCancel={onCancel}
        onSelect={onSelect}
      />,
    );
    await expect
      .element(page.getByRole("option", { name: /Current thread/ }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("commits clicked targets and cancels on Escape", async () => {
    const onCancel = vi.fn();
    const onSelect = vi.fn();
    const view = await render(
      <RecentThreadSwitcher
        open
        items={items}
        highlightedIndex={1}
        onCancel={onCancel}
        onSelect={onSelect}
      />,
    );
    try {
      await page.getByRole("option", { name: /Current thread/ }).click();
      expect(onSelect).toHaveBeenCalledWith(threadTarget);

      await userEvent.keyboard("{Escape}");
      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      await view.unmount();
    }
  });
});
