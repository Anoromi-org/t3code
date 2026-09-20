/**
 * The record stream hyprnav's frames socket speaks for video codecs
 * (FRAMES-VIDEO-PLAN §4), and the little bit of bitstream reading the client
 * needs on top of it.
 *
 *   u32 'HNVF' | u32 len | u32 flags | u64 pts_us | u16 width | u16 height | payload
 *
 * One record is one temporal unit (AV1) or access unit (H.264), which is
 * exactly one `EncodedVideoChunk`. The first record is CONFIG and carries a
 * NUL-terminated WebCodecs codec string, so the player never has to guess what
 * the daemon picked out of the codec list it asked for.
 */

export const HYPRNAV_RECORD_HEADER_BYTES = 24;

export const HYPRNAV_RECORD_KEYFRAME = 1;
export const HYPRNAV_RECORD_CONFIG = 2;
export const HYPRNAV_RECORD_KEEPALIVE = 4;

export interface HyprnavFrameRecord {
  readonly flags: number;
  /** Capture time in microseconds, as the daemon saw it. */
  readonly timestampUs: number;
  /** Encoder geometry; the decoded frame is what the canvas is sized from. */
  readonly width: number;
  readonly height: number;
  readonly payload: Uint8Array;
}

/** The stream is not the record stream at all, or lost its framing. */
export class HyprnavRecordDesyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HyprnavRecordDesyncError";
  }
}

const MAGIC = [0x48, 0x4e, 0x56, 0x46]; // "HNVF"

const concat = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  if (left.length === 0) return right;
  if (right.length === 0) return left;
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
};

export interface HyprnavRecordParser {
  /**
   * Adds one network chunk and returns every record it completed. Records
   * straddle chunks constantly, so the leftover stays inside the parser.
   */
  readonly push: (chunk: Uint8Array) => ReadonlyArray<HyprnavFrameRecord>;
  /** Bytes held back waiting for the rest of their record. */
  readonly pending: () => number;
}

export function createHyprnavRecordParser(): HyprnavRecordParser {
  let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  return {
    push: (chunk) => {
      buffered = concat(buffered, chunk);
      const records: HyprnavFrameRecord[] = [];
      for (;;) {
        if (buffered.length < HYPRNAV_RECORD_HEADER_BYTES) break;
        for (let index = 0; index < MAGIC.length; index += 1) {
          if (buffered[index] !== MAGIC[index]) {
            throw new HyprnavRecordDesyncError("frame record stream lost its magic");
          }
        }
        const view = new DataView(buffered.buffer, buffered.byteOffset, buffered.length);
        const length = view.getUint32(4, true);
        if (buffered.length < HYPRNAV_RECORD_HEADER_BYTES + length) break;
        records.push({
          flags: view.getUint32(8, true),
          // Microseconds since the epoch fit in a double for another 200 000
          // years; `EncodedVideoChunk` wants a number anyway.
          timestampUs: Number(view.getBigUint64(12, true)),
          width: view.getUint16(20, true),
          height: view.getUint16(22, true),
          payload: buffered.slice(
            HYPRNAV_RECORD_HEADER_BYTES,
            HYPRNAV_RECORD_HEADER_BYTES + length,
          ),
        });
        buffered = buffered.subarray(HYPRNAV_RECORD_HEADER_BYTES + length);
      }
      return records;
    },
    pending: () => buffered.length,
  };
}

export interface HyprnavFramesConfig {
  /** A WebCodecs codec string, e.g. `av01.0.08M.08` or `avc1.42E01E`. */
  readonly codec: string;
  /**
   * Out-of-band decoder config, if the codec has one. H.264 from hyprnav is
   * Annex-B and must be configured *without* a description (E3: Firefox and
   * Chromium both reject the avcC form fed Annex-B data).
   */
  readonly description: Uint8Array | null;
}

/** Reads the CONFIG record's payload: NUL-terminated codec string, then config. */
export function parseHyprnavFramesConfig(payload: Uint8Array): HyprnavFramesConfig | null {
  const end = payload.indexOf(0);
  if (end <= 0) return null;
  const codec = new TextDecoder().decode(payload.subarray(0, end));
  const description = payload.subarray(end + 1);
  return { codec, description: description.length > 0 ? description.slice() : null };
}

/** `av01.0.08M.08` -> `av1`. Everything here only cares about the family. */
export function hyprnavCodecFamily(codec: string): "av1" | "h264" | "vp9" | "other" {
  if (codec.startsWith("av01")) return "av1";
  if (codec.startsWith("avc1") || codec.startsWith("avc3")) return "h264";
  if (codec.startsWith("vp09") || codec === "vp9") return "vp9";
  return "other";
}

const readLeb128 = (bytes: Uint8Array, at: number): readonly [number, number] => {
  let value = 0;
  for (let index = 0; index < 8; index += 1) {
    const byte = bytes[at + index];
    if (byte === undefined) return [value, index + 1];
    value += (byte & 0x7f) * 2 ** (index * 7);
    if ((byte & 0x80) === 0) return [value, index + 1];
  }
  return [value, 8];
};

/**
 * True when this AV1 temporal unit starts a new coded video sequence, i.e. it
 * can be decoded without anything before it.
 */
export function av1TemporalUnitIsKeyframe(payload: Uint8Array): boolean {
  let at = 0;
  while (at < payload.length) {
    const header = payload[at]!;
    const type = (header >> 3) & 0xf;
    const hasExtension = (header >> 2) & 1;
    const hasSize = (header >> 1) & 1;
    let body = at + 1 + hasExtension;
    let size: number;
    if (hasSize) {
      const [value, used] = readLeb128(payload, body);
      size = value;
      body += used;
    } else {
      size = payload.length - body;
    }
    if (body > payload.length) return false;
    // OBU_FRAME_HEADER (3) and OBU_FRAME (6) both start with the frame header.
    if (type === 3 || type === 6) {
      const first = payload[body];
      if (first === undefined) return false;
      const showExisting = (first >> 7) & 1;
      // frame_type 0 is KEY_FRAME; a show_existing_frame header has none.
      if (showExisting === 0 && ((first >> 5) & 3) === 0) return true;
    }
    const next = body + size;
    if (next <= at) return false;
    at = next;
  }
  return false;
}

/** True when this Annex-B access unit contains an IDR slice (NAL type 5). */
export function h264AccessUnitIsKeyframe(payload: Uint8Array): boolean {
  for (let at = 0; at + 3 < payload.length; at += 1) {
    if (payload[at] !== 0 || payload[at + 1] !== 0) continue;
    const startCode =
      payload[at + 2] === 1 ? 3 : payload[at + 2] === 0 && payload[at + 3] === 1 ? 4 : 0;
    if (startCode === 0) continue;
    const nal = payload[at + startCode];
    if (nal === undefined) return false;
    if ((nal & 0x1f) === 5) return true;
    at += startCode - 1;
  }
  return false;
}

/**
 * Whether a record can start playback on its own, for streams whose daemon did
 * not flag it (or for resyncing after a desync): the flag is authoritative
 * when set, the bitstream is the fallback.
 */
export function hyprnavRecordIsKeyframe(codec: string, record: HyprnavFrameRecord): boolean {
  if ((record.flags & HYPRNAV_RECORD_KEYFRAME) !== 0) return true;
  switch (hyprnavCodecFamily(codec)) {
    case "av1":
      return av1TemporalUnitIsKeyframe(record.payload);
    case "h264":
      return h264AccessUnitIsKeyframe(record.payload);
    default:
      return false;
  }
}
