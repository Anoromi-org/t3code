import { describe, expect, it, vi } from "vite-plus/test";

import { routeDiffShortcut } from "./externalCorkdiffRouting.ts";

const makeInput = () => ({
  activeEnvironmentId: "primary",
  activeThreadId: "thread-1",
  activeWorkspaceRoot: "/repo",
  isServerThread: true,
  openExternalCorkdiff: vi.fn(async () => undefined),
  openInApp: vi.fn(),
  primaryEnvironmentId: "primary",
  reportExternalError: vi.fn(),
  toggleInApp: vi.fn(),
});

describe("routeDiffShortcut", () => {
  it("opens external Corkdiff for primary-local server threads", async () => {
    const input = makeInput();

    await routeDiffShortcut(input);

    expect(input.openExternalCorkdiff).toHaveBeenCalledWith({
      cwd: "/repo",
      threadId: "thread-1",
    });
    expect(input.toggleInApp).not.toHaveBeenCalled();
    expect(input.openInApp).not.toHaveBeenCalled();
  });

  it.each([
    ["browser", { openExternalCorkdiff: undefined }],
    ["remote", { activeEnvironmentId: "remote" }],
    ["non-server", { isServerThread: false }],
    ["unknown primary", { primaryEnvironmentId: null }],
  ])("keeps %s threads in the in-app viewer", async (_label, overrides) => {
    const input = { ...makeInput(), ...overrides };

    await routeDiffShortcut(input);

    expect(input.toggleInApp).toHaveBeenCalledOnce();
    expect(input.openInApp).not.toHaveBeenCalled();
  });

  it("reports a missing working directory and opens the in-app viewer", async () => {
    const input = { ...makeInput(), activeWorkspaceRoot: null };

    await routeDiffShortcut(input);

    expect(input.reportExternalError).toHaveBeenCalledWith(
      "The active thread does not have a working directory.",
    );
    expect(input.openInApp).toHaveBeenCalledOnce();
    expect(input.openExternalCorkdiff).not.toHaveBeenCalled();
  });

  it("reports IPC rejection and opens the in-app viewer", async () => {
    const input = makeInput();
    input.openExternalCorkdiff.mockRejectedValueOnce(new Error("Hyprnav unavailable"));

    await routeDiffShortcut(input);

    expect(input.reportExternalError).toHaveBeenCalledWith("Hyprnav unavailable");
    expect(input.openInApp).toHaveBeenCalledOnce();
  });
});
