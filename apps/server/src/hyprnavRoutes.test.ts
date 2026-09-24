// @effect-diagnostics nodeBuiltinImport:off -- The fake daemon is a real Unix socket.
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpRouter } from "effect/unstable/http";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { HyprnavCli, hyprnavRoutesLayer, isLoopbackHyprnavRequest } from "./hyprnavRoutes.ts";

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
});

const AGENTS = [
  {
    agent_id: "agent-1",
    label: "planner",
    current_target: "0xabc",
    attached_windows: ["0xdef"],
  },
];

/** Routes wired to a fake `hyprnav` CLI and, optionally, a fake frames socket. */
const fixture = (options: { readonly framesSocket?: string } = {}) => {
  const calls: Array<ReadonlyArray<string>> = [];
  const { handler, dispose } = HttpRouter.toWebHandler(
    hyprnavRoutesLayer.pipe(
      Layer.provideMerge(
        Layer.succeed(HyprnavCli, {
          runJson: (args) =>
            Effect.sync(() => {
              calls.push(args);
              return args[0] === "agents" ? AGENTS : { ok: true };
            }),
        }),
      ),
      Layer.provideMerge(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown(
            options.framesSocket ? { T3CODE_HYPRNAV_FRAMES_SOCKET: options.framesSocket } : {},
          ),
        ),
      ),
    ),
    { disableLogger: true },
  );
  disposers.push(dispose);
  return { handler, calls };
};

const request = (path: string, host: string, init: RequestInit = {}) =>
  new Request(`http://${host}${path}`, {
    ...init,
    headers: { host, ...(init.headers as Record<string, string> | undefined) },
  });

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** A daemon that records the request line and answers with one multipart frame. */
const fakeFramesDaemon = async () => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hyprnav-frames-"));
  const path = NodePath.join(dir, "frames.sock");
  const lines: string[] = [];
  const server = NodeNet.createServer((socket) => {
    socket.once("data", (chunk) => {
      lines.push(chunk.toString("utf8").trim());
      socket.end("--frame\r\nContent-Type: image/jpeg\r\n\r\nJPEG\r\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  disposers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          NodeFS.rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  );
  return { path, lines };
};

describe("hyprnav routes", () => {
  it.each([
    ["GET", "/api/hyprnav/agents"],
    ["GET", "/api/hyprnav/events"],
    ["GET", "/api/hyprnav/frames?address=0xabc"],
    ["POST", "/api/hyprnav/screencast"],
    ["POST", "/api/hyprnav/goto"],
  ])("answers %s %s with 404 on a non-loopback host", async (method, path) => {
    const { handler, calls } = fixture();
    const body = path.endsWith("goto") ? { env: "env", slot: 1 } : { address: "0xabc" };
    const response = await handler(
      request(path, "192.168.1.20:3773", method === "POST" ? jsonPost(body) : {}),
    );
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("hides the agent list from a cross-site page", async () => {
    const { handler, calls } = fixture();
    const response = await handler(
      request("/api/hyprnav/agents", "127.0.0.1:3773", {
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("serves the agent list on a loopback host", async () => {
    const { handler } = fixture();
    const response = await handler(request("/api/hyprnav/agents", "127.0.0.1:3773"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(AGENTS);
  });

  it("refuses frames of a window no registered agent names", async () => {
    const daemon = await fakeFramesDaemon();
    const { handler, calls } = fixture({ framesSocket: daemon.path });
    const response = await handler(request("/api/hyprnav/frames?address=0x999", "localhost:3773"));
    expect(response.status).toBe(404);
    expect(calls).toEqual([["agents"]]);
    expect(daemon.lines).toEqual([]);
  });

  it("streams an agent's attached window with a filtered codec list", async () => {
    const daemon = await fakeFramesDaemon();
    const { handler } = fixture({ framesSocket: daemon.path });
    const response = await handler(
      request("/api/hyprnav/frames?address=0xdef&codecs=av1,bogus&max_width=500", "[::1]:3773"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("multipart/x-mixed-replace; boundary=frame");
    expect(await response.text()).toContain("JPEG");
    expect(JSON.parse(daemon.lines[0]!)).toMatchObject({
      address: "0xdef",
      codecs: ["av1", "mjpeg"],
      max_width: 640,
    });
  });

  it("ignores a cross-site form post that is not JSON", async () => {
    const { handler, calls } = fixture();
    const response = await handler(
      request("/api/hyprnav/goto", "localhost:3773", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ env: "env", slot: 1 }),
      }),
    );
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("isLoopbackHyprnavRequest", () => {
  it("rejects a LAN peer that claims a loopback host", () => {
    expect(
      isLoopbackHyprnavRequest({
        host: "localhost:3773",
        remoteAddress: Option.some("192.168.1.20"),
      }),
    ).toBe(false);
  });

  it("accepts an IPv4-mapped loopback peer", () => {
    expect(
      isLoopbackHyprnavRequest({
        host: "127.0.0.1:3773",
        remoteAddress: Option.some("::ffff:127.0.0.1"),
      }),
    ).toBe(true);
  });

  it("rejects a website calling from a local browser", () => {
    const request = { host: "127.0.0.1:3773", remoteAddress: Option.some("127.0.0.1") };
    expect(isLoopbackHyprnavRequest({ ...request, origin: "https://evil.example" })).toBe(false);
    expect(isLoopbackHyprnavRequest({ ...request, origin: "null" })).toBe(false);
    expect(isLoopbackHyprnavRequest({ ...request, origin: "t3code://app" })).toBe(true);
    expect(isLoopbackHyprnavRequest({ ...request, origin: "http://localhost:5733" })).toBe(true);
  });

  it("rejects a loopback peer addressed by a tunnel or tailnet name", () => {
    expect(
      isLoopbackHyprnavRequest({
        host: "box.tailnet.ts.net",
        remoteAddress: Option.some("127.0.0.1"),
      }),
    ).toBe(false);
  });
});
