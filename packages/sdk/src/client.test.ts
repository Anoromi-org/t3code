// @effect-diagnostics nodeBuiltinImport:off - Tests exercise real HTTP and WebSocket boundaries.
import * as NodeHttp from "node:http";
import * as NodeEvents from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, describe, expect, expectTypeOf, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { WsRpcGroup, ServerConfig, type OrchestrationShellStreamItem } from "@t3tools/contracts";
import {
  connect,
  pair,
  CommandId,
  ProjectId,
  WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  type Client,
} from "./index.ts";
import { serverConfig } from "./fixture.ts";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});
const Request = Schema.TaggedStruct("Request", {
  id: Schema.Union([Schema.String, Schema.Number]),
  tag: Schema.String,
  payload: Schema.Unknown,
});
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const isRequest = Schema.is(Request);
const isPing = Schema.is(Schema.TaggedStruct("Ping", {}));
const isInterrupt = Schema.is(Schema.TaggedStruct("Interrupt", {}));
const encodeConfig = Schema.encodeSync(ServerConfig);

async function serve(
  options: { dropCommand?: boolean; denyCommand?: boolean; badConfig?: boolean } = {},
) {
  const methods: string[] = [];
  const interrupted = Promise.withResolvers<void>();
  const commandReceived = Promise.withResolvers<void>();
  let tickets = 0;
  let exchanges = 0;
  let socket: WebSocket | undefined;
  const http = NodeHttp.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/oauth/token") {
      exchanges++;
      response.end(
        encode({
          access_token: "test-bearer",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "orchestration:read",
        }),
      );
    } else if (
      request.url === "/api/auth/websocket-ticket" &&
      request.headers.authorization === "Bearer test-bearer"
    ) {
      tickets++;
      response.end(encode({ ticket: `ticket-${tickets}`, expiresAt: "2099-01-01T00:00:00.000Z" }));
    } else {
      response.statusCode = 401;
      response.end("{}");
    }
  });
  const ws = new WebSocketServer({ server: http });
  ws.on("connection", (peer, request) => {
    socket = peer;
    expect(request.url).toContain("wsTicket=ticket-");
    expect(request.url).not.toContain("test-bearer");
    peer.on("message", (data) => {
      const message = decode(data.toString());
      if (isPing(message)) {
        peer.send(encode({ _tag: "Pong" }));
        return;
      }
      if (isInterrupt(message)) {
        interrupted.resolve();
        return;
      }
      if (!isRequest(message)) return;
      methods.push(message.tag);
      const success = (value: unknown) =>
        peer.send(
          encode({ _tag: "Exit", requestId: message.id, exit: { _tag: "Success", value } }),
        );
      if (message.tag === WS_METHODS.serverGetConfig)
        success(options.badConfig ? {} : encodeConfig(serverConfig));
      else if (message.tag === ORCHESTRATION_WS_METHODS.dispatchCommand) {
        commandReceived.resolve();
        if (options.dropCommand) {
          peer.close();
          return;
        }
        if (options.denyCommand) {
          peer.send(
            encode({
              _tag: "Exit",
              requestId: message.id,
              exit: {
                _tag: "Failure",
                cause: [
                  {
                    _tag: "Fail",
                    error: {
                      _tag: "EnvironmentAuthorizationError",
                      message: "Read only",
                      requiredScope: "orchestration:operate",
                    },
                  },
                ],
              },
            }),
          );
        } else success({ sequence: 1 });
      } else if (message.tag === ORCHESTRATION_WS_METHODS.subscribeShell) {
        peer.send(
          encode({
            _tag: "Chunk",
            requestId: message.id,
            values: [
              {
                kind: "snapshot",
                snapshot: {
                  snapshotSequence: 0,
                  projects: [],
                  threads: [],
                  updatedAt: "2026-01-01T00:00:00.000Z",
                },
              },
            ],
          }),
        );
      }
    });
  });
  http.listen(0, "127.0.0.1");
  await NodeEvents.EventEmitter.once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  cleanups.push(async () => {
    for (const peer of ws.clients) peer.terminate();
    await new Promise<void>((resolve) => ws.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
  return {
    url: `http://127.0.0.1:${address.port}`,
    methods,
    interrupted,
    commandReceived,
    get tickets() {
      return tickets;
    },
    get exchanges() {
      return exchanges;
    },
    drop: () => socket?.close(),
  };
}
const command = {
  type: "project.create" as const,
  commandId: CommandId.make("sdk-command"),
  projectId: ProjectId.make("sdk-project"),
  title: "SDK",
  workspaceRoot: "/tmp/sdk",
  createdAt: "2026-01-01T00:00:00.000Z",
};
async function open(url: string) {
  const client = await connect({ url, token: "test-bearer" });
  cleanups.push(() => client.close());
  return client;
}

describe("SDK over HTTP and WebSocket", () => {
  it("pairs, exposes every contract method and dispatches a command", async () => {
    const server = await serve();
    const credential = await pair({ pairingUrl: `${server.url}/pair#token=one-time` });
    expect(credential).toEqual({ url: `${server.url}/`, token: "test-bearer" });
    const client = await open(credential.url);
    expect(Object.keys(client.rpc).sort()).toEqual([...WsRpcGroup.requests.keys()].sort());
    await expect(client.dispatchCommand(command)).resolves.toEqual({ sequence: 1 });
    expect(server.exchanges).toBe(1);
    expect(server.tickets).toBe(1);
  });
  it("streams snapshots and sends cancellation when the consumer breaks", async () => {
    const server = await serve();
    const client = await open(server.url);
    for await (const item of client.rpc[ORCHESTRATION_WS_METHODS.subscribeShell]({})) {
      expect(item.kind).toBe("snapshot");
      break;
    }
    await server.interrupted.promise;
    await expect(client.dispatchCommand(command)).resolves.toEqual({ sequence: 1 });
  });
  it("aborts a pending stream read", async () => {
    const server = await serve();
    const client = await open(server.url);
    const controller = new AbortController();
    const iterator = client.rpc[ORCHESTRATION_WS_METHODS.subscribeShell](
      {},
      { signal: controller.signal },
    )[Symbol.asyncIterator]();
    await iterator.next();
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toBeDefined();
    await server.interrupted.promise;
  });
  it("preserves permission failures", async () => {
    const server = await serve({ denyCommand: true });
    const client = await open(server.url);
    await expect(client.dispatchCommand(command)).rejects.toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredScope: "orchestration:operate",
    });
  });
  it("does not replay a command after losing its response", async () => {
    const server = await serve({ dropCommand: true });
    const client = await open(server.url);
    await expect(client.dispatchCommand(command)).rejects.toBeDefined();
    await client.closed;
    expect(
      server.methods.filter((tag) => tag === ORCHESTRATION_WS_METHODS.dispatchCommand),
    ).toHaveLength(1);
    const replacement = await open(server.url);
    expect(server.tickets).toBe(2);
    await replacement.close();
  });
  it("rejects malformed server responses and bad credentials", async () => {
    const server = await serve({ badConfig: true });
    await expect(open(server.url)).rejects.toBeDefined();
    await expect(connect({ url: server.url, token: "bad" })).rejects.toBeDefined();
  });
  it("close is idempotent and prevents later requests", async () => {
    const server = await serve();
    const client = await open(server.url);
    await Promise.all([client.close(), client.close(), client.closed]);
    await expect(client.dispatchCommand(command)).rejects.toBeDefined();
    expect(server.methods).toEqual([WS_METHODS.serverGetConfig]);
  });
  it("rejects aborted connection attempts before doing network work", async () => {
    await expect(
      connect({ url: "http://localhost:1", token: "unused", signal: AbortSignal.abort() }),
    ).rejects.toBeDefined();
  });

  it("cancels a custom authorizer even when it does not settle its promise", async () => {
    const started = Promise.withResolvers<void>();
    const controller = new AbortController();
    const pending = connect({
      url: "http://localhost:3773",
      signal: controller.signal,
      authorize: () => {
        started.resolve();
        return new Promise<string>(() => {});
      },
    });
    const rejected = expect(pending).rejects.toBeDefined();
    await started.promise;
    controller.abort();
    await rejected;
  });
});

// Compiled by the package typecheck; never called at runtime.
function typeChecks(client: Client) {
  expectTypeOf(client.dispatchCommand(command)).toEqualTypeOf<
    Promise<{ readonly sequence: number }>
  >();
  expectTypeOf(client.rpc[ORCHESTRATION_WS_METHODS.subscribeShell]({})).toEqualTypeOf<
    AsyncIterable<OrchestrationShellStreamItem>
  >();
  // @ts-expect-error Unknown methods are not callable.
  client.rpc["made.up"]({});
  // @ts-expect-error Commands require their contract fields.
  client.dispatchCommand({ type: "project.create" });
}
void typeChecks;
