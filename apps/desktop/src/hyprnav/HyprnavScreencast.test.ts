import type * as Electron from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

const getSources = vi.fn(async () => [{ id: "window:1", name: "agent window" }]);

vi.mock("electron", () => ({ desktopCapturer: { getSources } }));

const { armHyprnavDisplayMedia, handleHyprnavDisplayMediaRequest } =
  await import("./HyprnavScreencast.ts");

const request = {} as Electron.DisplayMediaRequestHandlerHandlerRequest;

const answer = (now: number) =>
  new Promise<Electron.Streams>((resolve) => {
    handleHyprnavDisplayMediaRequest(request, resolve, now);
  });

describe("handleHyprnavDisplayMediaRequest", () => {
  it("denies a request nobody armed without asking the portal", async () => {
    getSources.mockClear();
    expect(await answer(1_000)).toEqual({});
    expect(getSources).not.toHaveBeenCalled();
  });

  it("lets exactly one armed request reach the portal", async () => {
    armHyprnavDisplayMedia(1_000);
    expect(await answer(2_000)).toEqual({ video: { id: "window:1", name: "agent window" } });
    expect(await answer(2_001)).toEqual({});
  });

  it("forgets an arm that outlived hyprnav's pre-answer", async () => {
    armHyprnavDisplayMedia(1_000);
    expect(await answer(60_000)).toEqual({});
  });
});
