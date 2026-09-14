import {
  type AuthEnvironmentScope,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
} from "@t3tools/contracts";
import {
  bootstrapRemoteBearerSession,
  resolveRemoteWebSocketConnectionUrl,
} from "@t3tools/client-runtime/authorization";
import { makeWsRpcProtocolClient, remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { resolveRemotePairingTarget } from "@t3tools/shared/remote";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";
import { SdkConnectionError, wrapRpc, type RpcMethods, type CallOptions } from "./rpc.ts";

export interface Credential {
  readonly url: string;
  readonly token: string;
}
export interface ConnectOptions extends CallOptions {
  readonly url: string;
  readonly token?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocket?: (url: string) => globalThis.WebSocket;
  /** Custom authorization, including managed relay. Called once per connection. */
  readonly authorize?: (options: CallOptions) => Promise<string>;
  readonly timeoutMs?: number;
}
export interface PairOptions extends CallOptions {
  readonly pairingUrl: string;
  readonly scopes?: ReadonlyArray<AuthEnvironmentScope>;
  readonly label?: string;
  readonly fetch?: typeof globalThis.fetch;
}
export interface Client {
  readonly rpc: RpcMethods;
  readonly dispatchCommand: RpcMethods[typeof ORCHESTRATION_WS_METHODS.dispatchCommand];
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

/** Exchanges a one-time pairing link. Store the returned credential in your app's credential store. */
export async function pair(options: PairOptions): Promise<Credential> {
  const target = resolveRemotePairingTarget({ pairingUrl: options.pairingUrl });
  const result = await Effect.runPromise(
    bootstrapRemoteBearerSession({
      httpBaseUrl: target.httpBaseUrl,
      credential: target.credential,
      ...(options.scopes ? { scopes: options.scopes } : {}),
      ...(options.label ? { clientMetadata: { label: options.label } } : {}),
    }).pipe(Effect.provide(remoteHttpClientLayer(options.fetch ?? globalThis.fetch))),
    options,
  );
  return { url: target.httpBaseUrl, token: result.access_token };
}

/** Opens one authenticated connection. Requests and streams are never silently replayed. */
export async function connect(options: ConnectOptions): Promise<Client> {
  const endpoint = new URL(options.url);
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  ) {
    throw new SdkConnectionError(
      "Use an HTTP(S) environment origin without a path or credentials.",
    );
  }
  const timeoutMs = options.timeoutMs ?? 15_000;
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(timeoutMs),
  ]);
  signal.throwIfAborted();
  const wsBase = new URL("/ws", endpoint);
  wsBase.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  const authorize = options.authorize;
  const socketUrl = authorize
    ? await Effect.runPromise(
        Effect.tryPromise({
          try: (authorizationSignal) => authorize({ signal: authorizationSignal }),
          catch: (cause) => new SdkConnectionError("WebSocket authorization failed.", { cause }),
        }),
        { signal },
      )
    : await Effect.runPromise(
        resolveRemoteWebSocketConnectionUrl({
          httpBaseUrl: endpoint.origin,
          wsBaseUrl: wsBase.toString(),
          bearerToken: options.token ?? "",
          timeoutMs,
        }).pipe(Effect.provide(remoteHttpClientLayer(options.fetch ?? globalThis.fetch))),
        { signal },
      );
  signal.throwIfAborted();
  const scope = Scope.makeUnsafe();
  const lifetime = new AbortController();
  const closed = Promise.withResolvers<void>();
  let closing: Promise<void> | undefined;
  const close = () => {
    if (closing) return closing;
    lifetime.abort(
      new SdkConnectionError(
        "T3 Code connection closed. In-flight command outcomes may be unknown.",
      ),
    );
    closing = Effect.runPromise(Scope.close(scope, Exit.void)).finally(() => closed.resolve());
    return closing;
  };
  try {
    const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
      onConnect: Effect.void,
      onDisconnect: Effect.sync(() => {
        void close();
      }),
    });
    const socket = Socket.layerWebSocket(socketUrl, { openTimeout: timeoutMs }).pipe(
      Layer.provide(
        Layer.succeed(
          Socket.WebSocketConstructor,
          options.webSocket ?? ((url) => new globalThis.WebSocket(url)),
        ),
      ),
    );
    const protocol = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
      }),
    ).pipe(Layer.provide(Layer.mergeAll(socket, RpcSerialization.layerJson, hooks)));
    const context = await Effect.runPromise(Layer.build(protocol).pipe(Scope.provide(scope)), {
      signal,
    });
    const raw = await Effect.runPromise(
      makeWsRpcProtocolClient.pipe(Effect.provide(context), Scope.provide(scope)),
      { signal },
    );
    const rpc = wrapRpc(raw, lifetime.signal);
    // A socket upgrade alone does not prove the server can handle authenticated RPC.
    await rpc[WS_METHODS.serverGetConfig]({}, { signal });
    return {
      rpc,
      dispatchCommand: rpc[ORCHESTRATION_WS_METHODS.dispatchCommand],
      closed: closed.promise,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
