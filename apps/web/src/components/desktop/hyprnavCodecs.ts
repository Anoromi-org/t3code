/**
 * What this browser can decode, and what to do when the daemon answers with
 * something else.
 *
 * The rule from experiment E3 (2026-09-20): never gate on
 * `hardwareAcceleration`. Firefox 155 reports every codec as supported for
 * `prefer-hardware` whether or not a GPU is involved, so the answer means
 * nothing; what does mean something is `configure()` not throwing and frames
 * actually coming out, which only the player can find out.
 */

/** The record stream of FRAMES-VIDEO-PLAN §4; anything else is the JPEG one. */
export const HYPRNAV_VIDEO_CONTENT_TYPE = "application/vnd.hyprnav.frames";

interface CodecCandidate {
  /** The name the daemon knows, sent in `codecs`. */
  readonly name: string;
  /** A representative WebCodecs codec string to probe with. */
  readonly codec: string;
}

/**
 * Probe order, best first: AV1 encodes fastest on this GPU and both browsers
 * decode it; H.264 is the universal second; VP9 is a long shot that costs one
 * probe. HEVC is deliberately absent (E3: neither browser decodes it).
 */
export const HYPRNAV_CODEC_CANDIDATES: ReadonlyArray<CodecCandidate> = [
  { name: "av1", codec: "av01.0.08M.08" },
  // Annex-B, so no `description`, which is also how the daemon sends it.
  { name: "h264", codec: "avc1.42E01E" },
  { name: "vp9", codec: "vp09.00.10.08" },
];

/** JPEG in an `<img>`: no WebCodecs needed, and always last. */
export const HYPRNAV_FALLBACK_CODEC = "mjpeg";

export type HyprnavCodecProbe = (codec: string) => Promise<boolean>;

const probeWithVideoDecoder: HyprnavCodecProbe = async (codec) => {
  const decoder = globalThis.VideoDecoder;
  if (decoder === undefined) return false;
  try {
    // No `hardwareAcceleration`, no geometry: the daemon decides the size, and
    // a probe that pins one would answer about the wrong stream.
    const support = await decoder.isConfigSupported({ codec, optimizeForLatency: true });
    return support.supported === true;
  } catch {
    return false;
  }
};

/**
 * The `codecs` list to send, in preference order, with the JPEG fallback
 * appended so the daemon always has something it can serve.
 */
export async function probeHyprnavCodecs(
  probe: HyprnavCodecProbe = probeWithVideoDecoder,
): Promise<ReadonlyArray<string>> {
  const supported: string[] = [];
  for (const candidate of HYPRNAV_CODEC_CANDIDATES) {
    if (await probe(candidate.codec)) supported.push(candidate.name);
  }
  return [...supported, HYPRNAV_FALLBACK_CODEC];
}

export type HyprnavPlaybackMode = "video" | "mjpeg";

/**
 * Which player the response calls for. The daemon picks the codec, so the
 * content type decides, not what was asked for; and a browser without
 * `VideoDecoder` never even asks.
 */
export function hyprnavPlaybackMode(options: {
  readonly contentType: string | null;
  readonly hasVideoDecoder: boolean;
}): HyprnavPlaybackMode {
  if (!options.hasVideoDecoder) return "mjpeg";
  const type = (options.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type === HYPRNAV_VIDEO_CONTENT_TYPE ? "video" : "mjpeg";
}

/** The frames URL with the codec list this browser settled on. */
export function hyprnavFramesUrlWithCodecs(url: string, codecs: ReadonlyArray<string>): string {
  const base = typeof window === "undefined" ? "http://localhost" : window.location.href;
  const target = new URL(url, base);
  target.searchParams.set("codecs", codecs.join(","));
  return target.toString();
}
