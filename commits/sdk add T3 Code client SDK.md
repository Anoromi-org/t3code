# sdk add T3 Code client SDK

## Goal

`packages/sdk` (`@anoromi/t3code-sdk`): a small typed client for running T3 Code servers, with
`pair` and `connect` over the WebSocket RPC, async-iterable streams, and a React connection
component.

## Included Changes

- Ported to orchestration v2: `ORCHESTRATION_V2_WS_METHODS`, `OrchestrationV2Command`,
  `OrchestrationV2ShellStreamItem`, and `layerRemoteHttpClient`. Projects are created through
  `projects.mutate`, not an orchestration command, and the browser example follows the v2 shell
  items (`project.updated`, `project.removed`).
- `connect` adds the `orchestrationProtocol` query parameter the server now requires on the
  WebSocket, and builds its protocol client from `WsRpcGroup` because client-runtime no longer
  exports one.
- Typecheck uses upstream's `effect-tsgo tsrs`, and dependency versions follow the workspace
  catalog. WebSocket tickets come from upstream's route-bound `/api/auth/websocket-ticket/rpc`.
- `SdkConnectionError` stays a native `Error` because SDK callers are plain JavaScript.
- knip names the SDK's source entries, since its package exports point at `dist`.

## Known limitation

The npm package build cannot emit declarations for upstream's contracts. Their largest exports
(`WsRpcGroup`, the environment HTTP API, orchestration v2 commands, the guest stream) exceed what
TypeScript 7 (`effect-tsgo`) will serialize (TS7056), so `contracts/rpc.d.ts` is never written.
The two packaging tests stay skipped until those exports carry explicit types upstream; the build
script already uses `effect-tsgo`, since upstream ships no `tsc`. No other project consumes the
package.

## Validation Coverage

`client.test.ts` (pairing, every contract method, dispatch, streams and cancellation, aborts,
permission failures, no command replay) and `server.integration.test.ts` (a real T3 server:
project and thread creation through the SDK, read-only pairing refused a write).

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `e9c3e219ea` (previously onto `13aa882c22`
from `d2ac5a1ce2`, itself from `1ccaebca22`).
