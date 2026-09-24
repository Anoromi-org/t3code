import { describe, expect, it } from "vite-plus/test";

import {
  HYPRNAV_FRAMES_CONTENT_TYPE,
  HYPRNAV_VIDEO_CONTENT_TYPE,
  hyprnavFramesContentType,
} from "./hyprnavFrames.ts";
import { hyprnavFramesRequestFromQuery } from "./hyprnavRoutes.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("hyprnavFramesContentType", () => {
  it("names the record stream by its magic", () => {
    expect(hyprnavFramesContentType(bytes("HNVF  "))).toBe(HYPRNAV_VIDEO_CONTENT_TYPE);
  });

  it("treats a split magic as the record stream", () => {
    expect(hyprnavFramesContentType(bytes("HN"))).toBe(HYPRNAV_VIDEO_CONTENT_TYPE);
  });

  it("names the multipart stream by its boundary", () => {
    expect(hyprnavFramesContentType(bytes("--frame\r\n"))).toBe(HYPRNAV_FRAMES_CONTENT_TYPE);
  });

  it("falls back to multipart when nothing arrived yet", () => {
    expect(hyprnavFramesContentType(new Uint8Array(0))).toBe(HYPRNAV_FRAMES_CONTENT_TYPE);
  });
});

describe("hyprnavFramesRequestFromQuery", () => {
  const request = (query: string) =>
    hyprnavFramesRequestFromQuery("0xabc", new URLSearchParams(query));

  it("keeps the client's codec order and appends the fallback", () => {
    expect(request("codecs=av1,h264").codecs).toEqual(["av1", "h264", "mjpeg"]);
  });

  it("drops codecs the daemon was never meant to be asked for", () => {
    expect(request("codecs=av1,rm, h264 ,av1").codecs).toEqual(["av1", "h264", "mjpeg"]);
  });

  it("defaults to the JPEG fallback alone", () => {
    expect(request("").codecs).toEqual(["mjpeg"]);
  });

  it("rounds the width up to a tier", () => {
    expect(request("max_width=500").maxWidth).toBe(640);
    expect(request("max_width=640").maxWidth).toBe(640);
    expect(request("max_width=4000").maxWidth).toBe(1280);
    expect(request("max_width=nope").maxWidth).toBe(640);
  });

  it("clamps the frame rate and mirrors it onto the legacy field", () => {
    expect(request("max_fps=99").maxFps).toBe(15);
    expect(request("max_fps=0").maxFps).toBe(1);
    expect(request("max_fps=4").fps).toBe(4);
    expect(request("").maxFps).toBe(8);
  });

  it("only follows transients when asked in so many words", () => {
    expect(request("follow=transient").follow).toBe("transient");
    expect(request("follow=child").follow).toBe("target");
    expect(request("").follow).toBe("target");
  });
});
