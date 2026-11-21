import { describe, expect, it } from "vite-plus/test";

import {
  HYPRNAV_VIDEO_CONTENT_TYPE,
  hyprnavFramesUrlWithCodecs,
  hyprnavPlaybackMode,
  probeHyprnavCodecs,
} from "./hyprnavCodecs";

describe("probeHyprnavCodecs", () => {
  it("keeps the preference order and always appends the JPEG fallback", async () => {
    expect(await probeHyprnavCodecs(async () => true)).toEqual(["av1", "h264", "vp9", "mjpeg"]);
  });

  it("drops what the browser cannot decode", async () => {
    const probe = async (codec: string) => codec.startsWith("avc1");
    expect(await probeHyprnavCodecs(probe)).toEqual(["h264", "mjpeg"]);
  });

  it("asks for JPEG alone when nothing decodes", async () => {
    expect(await probeHyprnavCodecs(async () => false)).toEqual(["mjpeg"]);
  });

  it("never probes hardware acceleration, which Firefox answers yes to regardless", async () => {
    const asked: string[] = [];
    await probeHyprnavCodecs(async (codec) => {
      asked.push(codec);
      return false;
    });
    expect(asked).toEqual(["av01.0.08M.08", "avc1.42E01E", "vp09.00.10.08"]);
  });
});

describe("hyprnavPlaybackMode", () => {
  it("plays video when the daemon sent the record stream", () => {
    expect(
      hyprnavPlaybackMode({ contentType: HYPRNAV_VIDEO_CONTENT_TYPE, hasVideoDecoder: true }),
    ).toBe("video");
  });

  it("ignores content-type parameters and case", () => {
    expect(
      hyprnavPlaybackMode({
        contentType: "Application/vnd.hyprnav.frames; charset=binary",
        hasVideoDecoder: true,
      }),
    ).toBe("video");
  });

  it("falls back when the daemon answered with the JPEG stream", () => {
    expect(
      hyprnavPlaybackMode({
        contentType: "multipart/x-mixed-replace; boundary=frame",
        hasVideoDecoder: true,
      }),
    ).toBe("mjpeg");
  });

  it("falls back without WebCodecs whatever the daemon sent", () => {
    expect(
      hyprnavPlaybackMode({ contentType: HYPRNAV_VIDEO_CONTENT_TYPE, hasVideoDecoder: false }),
    ).toBe("mjpeg");
  });

  it("falls back when there is no content type at all", () => {
    expect(hyprnavPlaybackMode({ contentType: null, hasVideoDecoder: true })).toBe("mjpeg");
  });
});

describe("hyprnavFramesUrlWithCodecs", () => {
  it("adds the list without disturbing the rest of the query", () => {
    const url = hyprnavFramesUrlWithCodecs(
      "http://localhost:1/api/hyprnav/frames?address=0xab&follow=transient",
      ["av1", "mjpeg"],
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("codecs")).toBe("av1,mjpeg");
    expect(parsed.searchParams.get("address")).toBe("0xab");
    expect(parsed.searchParams.get("follow")).toBe("transient");
  });

  it("replaces a list that was already there", () => {
    const url = hyprnavFramesUrlWithCodecs("http://localhost:1/f?codecs=h264", ["mjpeg"]);
    expect(new URL(url).searchParams.getAll("codecs")).toEqual(["mjpeg"]);
  });
});
