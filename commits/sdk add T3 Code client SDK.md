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
- Typecheck uses `tsc-rs`, and dependency versions follow the workspace catalog.

## Known limitation

The npm package build cannot emit declarations for upstream's contracts. Their largest exports
(`WsRpcGroup`, the environment HTTP API, orchestration v2 commands) exceed what TypeScript will
serialize (TS7056), so `contracts/rpc.d.ts` is never written. The packaging tests are skipped
until those exports carry explicit types upstream. No other project consumes the package.

## Validation Coverage

`client.test.ts` (pairing, every contract method, dispatch, streams and cancellation, aborts,
permission failures, no command replay) and `server.integration.test.ts` (a real T3 server:
project and thread creation through the SDK, read-only pairing refused a write).

## Reimplementation Sources

Reapplied onto upstream `13aa882c22` from fork commit `d2ac5a1ce2` (itself from `1ccaebca22`).
