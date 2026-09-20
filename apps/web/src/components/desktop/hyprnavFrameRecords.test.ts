import { describe, expect, it } from "vite-plus/test";

import {
  av1TemporalUnitIsKeyframe,
  createHyprnavRecordParser,
  h264AccessUnitIsKeyframe,
  HYPRNAV_RECORD_CONFIG,
  HYPRNAV_RECORD_KEEPALIVE,
  HYPRNAV_RECORD_KEYFRAME,
  HyprnavRecordDesyncError,
  hyprnavCodecFamily,
  hyprnavRecordIsKeyframe,
  parseHyprnavFramesConfig,
} from "./hyprnavFrameRecords";

const record = (payload: Uint8Array, flags: number, timestampUs = 0, width = 640, height = 368) => {
  const bytes = new Uint8Array(24 + payload.length);
  bytes.set([0x48, 0x4e, 0x56, 0x46]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, payload.length, true);
  view.setUint32(8, flags, true);
  view.setBigUint64(12, BigInt(timestampUs), true);
  view.setUint16(20, width, true);
  view.setUint16(22, height, true);
  bytes.set(payload, 24);
  return bytes;
};

const join = (...chunks: ReadonlyArray<Uint8Array>) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
};

describe("createHyprnavRecordParser", () => {
  it("reads a record's header and payload", () => {
    const parser = createHyprnavRecordParser();
    const parsed = parser.push(record(new Uint8Array([1, 2, 3]), HYPRNAV_RECORD_KEYFRAME, 1234));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      flags: HYPRNAV_RECORD_KEYFRAME,
      timestampUs: 1234,
      width: 640,
      height: 368,
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(parser.pending()).toBe(0);
  });

  it("reassembles a record split across chunks", () => {
    const parser = createHyprnavRecordParser();
    const bytes = record(new Uint8Array([7, 7, 7, 7]), 0);
    expect(parser.push(bytes.subarray(0, 5))).toHaveLength(0);
    expect(parser.push(bytes.subarray(5, 26))).toHaveLength(0);
    expect(parser.pending()).toBe(26);
    const parsed = parser.push(bytes.subarray(26));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.payload).toEqual(new Uint8Array([7, 7, 7, 7]));
  });

  it("returns every record a chunk completed, in order", () => {
    const parser = createHyprnavRecordParser();
    const parsed = parser.push(
      join(
        record(new Uint8Array([0]), HYPRNAV_RECORD_CONFIG),
        record(new Uint8Array([1]), HYPRNAV_RECORD_KEYFRAME),
        record(new Uint8Array(), HYPRNAV_RECORD_KEEPALIVE, 0, 0, 0),
      ),
    );
    expect(parsed.map((entry) => entry.flags)).toEqual([
      HYPRNAV_RECORD_CONFIG,
      HYPRNAV_RECORD_KEYFRAME,
      HYPRNAV_RECORD_KEEPALIVE,
    ]);
  });

  it("carries an empty keepalive payload", () => {
    const parser = createHyprnavRecordParser();
    const parsed = parser.push(record(new Uint8Array(), HYPRNAV_RECORD_KEEPALIVE, 9, 0, 0));
    expect(parsed[0]!.payload).toHaveLength(0);
  });

  it("refuses a stream that is not the record stream", () => {
    const parser = createHyprnavRecordParser();
    expect(() => parser.push(new TextEncoder().encode("--frame\r\nContent-Type: image"))).toThrow(
      HyprnavRecordDesyncError,
    );
  });
});

describe("parseHyprnavFramesConfig", () => {
  it("reads the codec string and no description", () => {
    const payload = join(new TextEncoder().encode("av01.0.08M.08"), new Uint8Array([0]));
    expect(parseHyprnavFramesConfig(payload)).toEqual({
      codec: "av01.0.08M.08",
      description: null,
    });
  });

  it("reads the out-of-band config after the codec string", () => {
    const payload = join(
      new TextEncoder().encode("avc1.42E01E"),
      new Uint8Array([0, 0x01, 0x42, 0xe0]),
    );
    expect(parseHyprnavFramesConfig(payload)).toEqual({
      codec: "avc1.42E01E",
      description: new Uint8Array([0x01, 0x42, 0xe0]),
    });
  });

  it("rejects a payload with no terminator", () => {
    expect(parseHyprnavFramesConfig(new TextEncoder().encode("av01"))).toBeNull();
    expect(parseHyprnavFramesConfig(new Uint8Array([0]))).toBeNull();
  });
});

describe("hyprnavCodecFamily", () => {
  it("names the families the player can read bitstreams of", () => {
    expect(hyprnavCodecFamily("av01.0.08M.08")).toBe("av1");
    expect(hyprnavCodecFamily("avc1.42E01E")).toBe("h264");
    expect(hyprnavCodecFamily("vp09.00.10.08")).toBe("vp9");
    expect(hyprnavCodecFamily("hvc1.1.6.L93.B0")).toBe("other");
  });
});

/** One OBU with a size field, as ffmpeg writes them. */
const obu = (type: number, body: Uint8Array) =>
  join(new Uint8Array([(type << 3) | 0b10, body.length]), body);

const OBU_SEQUENCE_HEADER = 1;
const OBU_FRAME = 6;
const OBU_TEMPORAL_DELIMITER = 2;

describe("av1TemporalUnitIsKeyframe", () => {
  it("finds a key frame header in a temporal unit", () => {
    const unit = join(
      obu(OBU_TEMPORAL_DELIMITER, new Uint8Array()),
      obu(OBU_SEQUENCE_HEADER, new Uint8Array([0x0c, 0x00])),
      // show_existing_frame = 0, frame_type = 0 (KEY_FRAME)
      obu(OBU_FRAME, new Uint8Array([0b0001_0000, 0x42])),
    );
    expect(av1TemporalUnitIsKeyframe(unit)).toBe(true);
  });

  it("does not mistake an inter frame for a key frame", () => {
    // frame_type = 1 (INTER_FRAME)
    const unit = obu(OBU_FRAME, new Uint8Array([0b0010_0000, 0x42]));
    expect(av1TemporalUnitIsKeyframe(unit)).toBe(false);
  });

  it("ignores a show_existing_frame header, which carries no frame type", () => {
    const unit = obu(OBU_FRAME, new Uint8Array([0b1000_0000, 0x00]));
    expect(av1TemporalUnitIsKeyframe(unit)).toBe(false);
  });

  it("stops on a truncated unit instead of looping", () => {
    expect(av1TemporalUnitIsKeyframe(new Uint8Array([(OBU_FRAME << 3) | 0b10]))).toBe(false);
    expect(av1TemporalUnitIsKeyframe(new Uint8Array())).toBe(false);
  });
});

describe("h264AccessUnitIsKeyframe", () => {
  it("finds an IDR slice behind a four-byte start code", () => {
    const unit = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x65, 0x88]);
    expect(h264AccessUnitIsKeyframe(unit)).toBe(true);
  });

  it("finds an IDR slice behind a three-byte start code", () => {
    expect(h264AccessUnitIsKeyframe(new Uint8Array([0, 0, 1, 0x65, 0x88]))).toBe(true);
  });

  it("says no to a unit of non-IDR slices", () => {
    const unit = new Uint8Array([0, 0, 0, 1, 0x09, 0x10, 0, 0, 0, 1, 0x41, 0x9a]);
    expect(h264AccessUnitIsKeyframe(unit)).toBe(false);
  });
});

describe("hyprnavRecordIsKeyframe", () => {
  const parsed = (payload: Uint8Array, flags: number) =>
    createHyprnavRecordParser().push(record(payload, flags))[0]!;

  it("believes the daemon's flag without reading the payload", () => {
    expect(hyprnavRecordIsKeyframe("av01.0.08M.08", parsed(new Uint8Array([9]), 1))).toBe(true);
  });

  it("reads the bitstream when the flag is missing", () => {
    const unit = obu(OBU_FRAME, new Uint8Array([0b0001_0000, 0x42]));
    expect(hyprnavRecordIsKeyframe("av01.0.08M.08", parsed(unit, 0))).toBe(true);
    expect(hyprnavRecordIsKeyframe("avc1.42E01E", parsed(new Uint8Array([0, 0, 1, 0x65]), 0))).toBe(
      true,
    );
  });

  it("gives up on codecs it cannot read", () => {
    expect(hyprnavRecordIsKeyframe("vp09.00.10.08", parsed(new Uint8Array([1, 2, 3]), 0))).toBe(
      false,
    );
    expect(hyprnavRecordIsKeyframe("", parsed(new Uint8Array([1, 2, 3]), 0))).toBe(false);
  });
});
