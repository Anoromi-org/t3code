// @effect-diagnostics nodeBuiltinImport:off
/**
 * Loopback-only HTTP routes exposing hyprnav's desktop-agent registry to the
 * web client when it runs in a browser on the same machine (no Electron
 * bridge). They wrap the `hyprnav` CLI's JSON output:
 *
 *   GET  /api/hyprnav/agents               -> agents_list
 *   POST /api/hyprnav/screencast {address} -> pre-answer the next share picker
 *   POST /api/hyprnav/goto {env, slot}     -> hyprnav goto
 *
 * Only requests that arrive on a loopback host are served; anything else gets
 * 404 so the routes are invisible over LAN or Tailscale.
 */
import * as NodeChildProcess from "node:child_process";

import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

class HyprnavRouteError extends Schema.TaggedErrorClass<HyprnavRouteError>()(
  "HyprnavRouteError",
  { args: Schema.Array(Schema.String), cause: Schema.Defect() },
) {}

const runHyprnavJson = (args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<unknown>((resolve, reject) => {
        NodeChildProcess.execFile(
          "hyprnav",
          [...args],
          { timeout: 5_000, maxBuffer: 4 << 20 },
          (error, stdout) => {
            if (error) {
              reject(error);
              return;
            }
            try {
              resolve(JSON.parse(stdout));
            } catch (parseError) {
              reject(parseError);
            }
          },
        );
      }),
    catch: (cause) => new HyprnavRouteError({ args: [...args], cause }),
  });

const requestIsLoopback = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const host = request.headers.host ?? "";
  const hostname = host.replace(/:\d+$/u, "");
  return LOOPBACK_HOSTNAMES.has(hostname);
});

const notFound = HttpServerResponse.empty({ status: 404 });

const ScreencastBody = Schema.Struct({ address: Schema.String });
const GotoBody = Schema.Struct({ env: Schema.String, slot: Schema.Number });

export const hyprnavAgentsRouteLayer = HttpRouter.add(
  "GET",
  "/api/hyprnav/agents",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const agents = yield* runHyprnavJson(["agents"]).pipe(Effect.orElseSucceed(() => []));
    return HttpServerResponse.jsonUnsafe(agents);
  }),
);

export const hyprnavScreencastRouteLayer = HttpRouter.add(
  "POST",
  "/api/hyprnav/screencast",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const decoded = Schema.decodeUnknownOption(ScreencastBody)(body);
    if (decoded._tag === "None" || !/^(address:)?0x[0-9a-fA-F]+$/u.test(decoded.value.address)) {
      return HttpServerResponse.empty({ status: 400 });
    }
    yield* runHyprnavJson(["screencast", "request", decoded.value.address]).pipe(
      Effect.orElseSucceed(() => null),
    );
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }),
);

export const hyprnavGotoRouteLayer = HttpRouter.add(
  "POST",
  "/api/hyprnav/goto",
  Effect.gen(function* () {
    if (!(yield* requestIsLoopback)) return notFound;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const body = yield* request.json;
    const decoded = Schema.decodeUnknownOption(GotoBody)(body);
    if (decoded._tag === "None") {
      return HttpServerResponse.empty({ status: 400 });
    }
    yield* runHyprnavJson([
      "goto",
      "--env",
      decoded.value.env,
      "--slot",
      String(decoded.value.slot),
    ]).pipe(Effect.orElseSucceed(() => null));
    return HttpServerResponse.jsonUnsafe({ ok: true });
  }),
);

export const hyprnavRoutesLayer = Layer.mergeAll(
  hyprnavAgentsRouteLayer,
  hyprnavScreencastRouteLayer,
  hyprnavGotoRouteLayer,
);
