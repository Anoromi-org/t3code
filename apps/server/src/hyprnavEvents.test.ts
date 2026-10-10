// @effect-diagnostics nodeBuiltinImport:off -- A fake daemon on a Unix socket, outside the Effect runtime like the broker.
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { HyprnavEventsBroker, type HyprnavStreamEvent } from "./hyprnavEvents.ts";

const LOCKED_LINE = JSON.stringify({
  event: "locked",
  ts_ms: 1,
  seq: 7,
  locked_environment_id: "p.0123456789ab.w.0123456789ab.t.thread-b",
  previous_environment_id: null,
  cause: "snapshot",
  origin: null,
  environment: null,
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A fake daemon that writes the connect burst to every subscriber. */
const fakeDaemon = async (burst: ReadonlyArray<string>): Promise<string> => {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hyprnav-events-"));
  const path = NodePath.join(dir, "events.sock");
  const server = NodeNet.createServer((socket) => {
    socket.write(burst.map((line) => `${line}\n`).join(""));
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  cleanups.push(() => {
    server.close();
    NodeFS.rmSync(dir, { recursive: true, force: true });
  });
  return path;
};

const nextDaemonEvent = (
  broker: HyprnavEventsBroker,
  name: string,
): Promise<{ event: HyprnavStreamEvent; release: () => void }> =>
  new Promise((resolve) => {
    const release = broker.subscribe((event) => {
      if (event.kind === "daemon" && event.event === name) resolve({ event, release });
    });
  });

describe("HyprnavEventsBroker", () => {
  it("forwards locked lines and replays the latest one to late subscribers", async () => {
    const path = await fakeDaemon([
      JSON.stringify({ event: "hello", ts_ms: 1, version: 1 }),
      JSON.stringify({ event: "slots", ts_ms: 1 }),
      LOCKED_LINE,
    ]);
    const broker = new HyprnavEventsBroker(() => path);

    const first = await nextDaemonEvent(broker, "locked");
    cleanups.push(first.release);
    expect(first.event).toEqual({ kind: "daemon", event: "locked", data: LOCKED_LINE });

    // The second subscriber shares the open connection and gets the baseline synchronously.
    const replayed: HyprnavStreamEvent[] = [];
    const release = broker.subscribe((event) => replayed.push(event));
    cleanups.push(release);
    expect(replayed).toContainEqual({ kind: "daemon", event: "locked", data: LOCKED_LINE });
    expect(replayed.flatMap((event) => (event.kind === "daemon" ? [event.event] : []))).toEqual([
      "slots",
      "locked",
    ]);
  });
});
