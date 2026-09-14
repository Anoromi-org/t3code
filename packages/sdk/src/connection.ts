import {
  connect,
  pair,
  type Client,
  type ConnectOptions,
  type Credential,
  type PairOptions,
} from "./client.ts";

export type ConnectionState =
  | { readonly status: "disconnected" }
  | { readonly status: "connecting" }
  | { readonly status: "connected"; readonly client: Client; readonly url: string }
  | { readonly status: "error"; readonly error: unknown; readonly canReconnect: boolean };

export interface Connection {
  getSnapshot(): ConnectionState;
  subscribe(listener: () => void): () => void;
  connect(credential: Credential): Promise<void>;
  pair(pairingUrl: string): Promise<void>;
  reconnect(): Promise<void>;
  disconnect(): Promise<void>;
}

/** Own one connection outside React. Disconnect before disposing its owner. */
export function createConnection(
  options: {
    readonly transport?: Omit<ConnectOptions, "url" | "token" | "signal">;
    readonly pairing?: Omit<PairOptions, "pairingUrl" | "signal">;
    /** Called immediately after pairing, before dialing, so a consumed link is never needed again. */
    readonly saveCredential?: (credential: Credential) => Promise<void>;
  } = {},
): Connection {
  let state: ConnectionState = { status: "disconnected" };
  let credential: Credential | undefined;
  let client: Client | undefined;
  let attempt: AbortController | undefined;
  const listeners = new Set<() => void>();
  const update = (next: ConnectionState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const stop = async () => {
    attempt?.abort();
    attempt = undefined;
    const previous = client;
    client = undefined;
    await previous?.close();
  };
  const start = async (getCredential: (signal: AbortSignal) => Promise<Credential>) => {
    const stopped = stop();
    const current = new AbortController();
    attempt = current;
    update({ status: "connecting" });
    try {
      await stopped;
      current.signal.throwIfAborted();
      const next = await getCredential(current.signal);
      current.signal.throwIfAborted();
      credential = next;
      const connected = await connect({ ...options.transport, ...next, signal: current.signal });
      if (current.signal.aborted) {
        await connected.close();
        return;
      }
      client = connected;
      update({ status: "connected", client: connected, url: next.url });
      void connected.closed.then(() => {
        if (client !== connected) return;
        client = undefined;
        update({
          status: "error",
          error: new Error("Connection lost. Reconnect to continue."),
          canReconnect: true,
        });
      });
    } catch (error) {
      if (!current.signal.aborted)
        update({ status: "error", error, canReconnect: credential !== undefined });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: (next) => start(async () => next),
    pair: (pairingUrl) =>
      start(async (signal) => {
        const next = await pair({ ...options.pairing, pairingUrl, signal });
        signal.throwIfAborted();
        credential = next;
        await options.saveCredential?.(next);
        return next;
      }),
    reconnect: () =>
      start(async () => {
        if (!credential) throw new Error("Pair with T3 Code first.");
        return credential;
      }),
    async disconnect() {
      credential = undefined;
      const stopped = stop();
      update({ status: "disconnected" });
      await stopped;
    },
  };
}
