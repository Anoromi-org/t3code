// @effect-diagnostics nodeBuiltinImport:off - Verifies the built distributable rather than workspace imports.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";
import { afterEach, beforeAll, expect, it, vi } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ServerConfig, WS_METHODS } from "@t3tools/contracts";
import { serverConfig } from "./fixture.ts";

beforeAll(() => {
  NodeChildProcess.execFileSync(
    process.execPath,
    [
      NodeURL.fileURLToPath(new URL("./bin/vp", import.meta.resolve("vite-plus/package.json"))),
      "run",
      "build",
    ],
    { cwd: NodeURL.fileURLToPath(new URL("..", import.meta.url)), stdio: "pipe" },
  );
}, 15_000);
afterEach(() => vi.useRealTimers());

const decodePacket = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodePacket = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isPing = Schema.is(Schema.TaggedStruct("Ping", {}));
const isRequest = Schema.is(
  Schema.TaggedStruct("Request", {
    id: Schema.Union([Schema.String, Schema.Number]),
    tag: Schema.String,
  }),
);
const encodeConfig = Schema.encodeSync(ServerConfig);

const decodeManifest = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      name: Schema.String,
      version: Schema.String,
      license: Schema.String,
      publishConfig: Schema.Struct({ access: Schema.String }),
      exports: Schema.Record(
        Schema.String,
        Schema.Union([
          Schema.String,
          Schema.Struct({ types: Schema.String, import: Schema.String }),
        ]),
      ),
    }),
  ),
);
const decodePack = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Array(Schema.Struct({ files: Schema.Array(Schema.Struct({ path: Schema.String })) })),
  ),
);

it("packs public npm metadata, licenses, and every exported entry without workspace dependencies", async () => {
  const directory = NodeURL.fileURLToPath(new URL("../dist", import.meta.url));
  const manifestText = await NodeFSP.readFile(`${directory}/package.json`, "utf8");
  const manifest = decodeManifest(manifestText);
  expect(manifestText).not.toMatch(/workspace:|catalog:|"private"|"devDependencies"/);
  expect(manifest.license).toBe("MIT");
  expect(manifest.publishConfig.access).toBe("public");

  const packed = decodePack(
    NodeChildProcess.execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: directory,
      encoding: "utf8",
      // oxlint-disable-next-line t3code/no-global-process-runtime -- npm.cmd requires a shell on the test host.
      shell: process.platform === "win32",
    }),
  );
  const files = packed[0]?.files.map((file) => file.path);
  expect(files).toEqual(
    expect.arrayContaining([
      "README.md",
      "LICENSE",
      "LICENSE-effect",
      "LICENSE-jose",
      "LICENSE-msgpackr",
      "LICENSE-multipasta",
    ]),
  );
  for (const entry of Object.values(manifest.exports)) {
    for (const path of typeof entry === "string" ? [entry] : [entry.types, entry.import]) {
      expect(files).toContain(path.replace(/^\.\//, ""));
    }
  }
  expect(files?.some((path) => path.endsWith(".test.ts") || path.startsWith("node_modules/"))).toBe(
    false,
  );
});

class HeartbeatSocket extends EventTarget {
  readyState = 1;
  pings = 0;
  send(data: string) {
    const packet = decodePacket(data);
    if (isPing(packet)) {
      this.pings++;
      return;
    }
    if (isRequest(packet) && packet.tag === WS_METHODS.serverGetConfig) {
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: encodePacket({
              _tag: "Exit",
              requestId: packet.id,
              exit: { _tag: "Success", value: encodeConfig(serverConfig) },
            }),
          }),
        ),
      );
    }
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
  pong() {
    this.dispatchEvent(new MessageEvent("message", { data: encodePacket({ _tag: "Pong" }) }));
  }
}

it("the published runtime survives delayed pongs and closes after sustained heartbeat loss", async () => {
  const sdk: typeof import("./index.ts") = await import(
    new URL("../dist/index.js", import.meta.url).href
  );
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const socket = new HeartbeatSocket();
  const client = await sdk.connect({
    url: "http://localhost:3773",
    authorize: async () => "ws://localhost:3773/ws",
    webSocket: () => socket as unknown as WebSocket,
  });
  try {
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.pings).toBe(2);
    expect(socket.readyState).toBe(1);
    socket.pong();
    await expect(client.rpc[WS_METHODS.serverGetConfig]({})).resolves.toMatchObject({
      environment: { label: "SDK test" },
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await client.closed;
    expect(socket.readyState).toBe(3);
  } finally {
    await client.close();
  }
});
