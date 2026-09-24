import { WsRpcGroup } from "@t3tools/contracts";
import type { RpcClient } from "effect/unstable/rpc/RpcClient";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import * as RpcSchema from "effect/unstable/rpc/RpcSchema";

type Rpcs = RpcGroup.Rpcs<typeof WsRpcGroup>;
type WsRpcProtocolClient = RpcClient<Rpcs, RpcClientError>;
type RpcFailure = Rpc.ErrorExit<Rpcs> | RpcClientError;

export interface CallOptions {
  readonly signal?: AbortSignal;
}

export type RpcMethods = {
  readonly [R in Rpcs as Rpc.Tag<R>]: (
    input: Rpc.PayloadConstructor<R>,
    options?: CallOptions,
  ) => Rpc.Success<R> extends Stream.Stream<infer A, infer _E, infer _R>
    ? AsyncIterable<A>
    : Promise<Rpc.Success<R>>;
};

export class SdkConnectionError extends Error {
  override readonly name = "SdkConnectionError";
}

// This is the single boundary from the heterogeneous contract map to JS methods.
// Both the public types and stream classification come from the same RPC group.
export function wrapRpc(client: WsRpcProtocolClient, lifetime: AbortSignal): RpcMethods {
  const methods: Record<string, (input: unknown, options?: CallOptions) => unknown> = {};
  for (const [tag, rpc] of WsRpcGroup.requests) {
    const method = client[tag as keyof WsRpcProtocolClient] as (
      input: unknown,
    ) => Effect.Effect<unknown, RpcFailure> | Stream.Stream<unknown, RpcFailure>;
    methods[tag] = (input, options) => {
      const signal = options?.signal ? AbortSignal.any([lifetime, options.signal]) : lifetime;
      if (RpcSchema.isStreamSchema(rpc.successSchema)) {
        return {
          [Symbol.asyncIterator]() {
            signal.throwIfAborted();
            const iterator = Stream.toAsyncIterable(
              method(input) as Stream.Stream<unknown, RpcFailure>,
            )[Symbol.asyncIterator]();
            const abort = () => {
              void iterator.return?.();
            };
            signal.addEventListener("abort", abort, { once: true });
            const cleanup = () => signal.removeEventListener("abort", abort);
            return {
              async next() {
                try {
                  signal.throwIfAborted();
                  const result = await iterator.next();
                  signal.throwIfAborted();
                  if (result.done) cleanup();
                  return result;
                } catch (error) {
                  cleanup();
                  throw error;
                }
              },
              async return() {
                cleanup();
                return iterator.return
                  ? iterator.return()
                  : { done: true as const, value: undefined };
              },
            };
          },
        };
      }
      return Effect.runPromise(method(input) as Effect.Effect<unknown, RpcFailure>, { signal });
    };
  }
  return methods as RpcMethods;
}
