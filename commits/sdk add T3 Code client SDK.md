# SDK: add T3 Code client SDK

`packages/sdk` publishes `@anoromi/t3code-sdk`, which connects a Node 24+ tool or browser app to an existing T3 Code environment. It exposes every WebSocket RPC in the server contracts with typed inputs and results, including all orchestration commands. It does not start a server or provider.

`connect({ url, token })` returns `t3.rpc` keyed by the existing method names plus a `dispatchCommand` alias. Ordinary RPCs return promises; subscriptions and streams return async iterables, and both accept `{ signal }`. `pair({ pairingUrl, label, scopes })` exchanges a one-time pairing link for a credential the caller stores. `@anoromi/t3code-sdk/contracts` re-exports schemas, types and branded ID constructors. A React entry provides connection hooks and a small stylesheet.

The package builds its types from the workspace contracts so it follows upstream contract changes without hand-written copies.

## Provenance

- Reapplies fork commit `1ccaebca22` ("t3-sdk").
- Upstream now uses TypeScript 7 `tsc` (no `tsgo`): the `typecheck` script, the declaration build in `scripts/build-types.ts`, and the README commands use `tsc`.
- Effect 4.0.0-rc.115 no longer depends on `msgpackr` or `multipasta`, so the build stops copying their licenses and the package test no longer expects them.
- The declaration rewrite also covers inline `import("./x.ts")` types, which the upstream contracts now produce; the package test checks that no published declaration references a `.ts` file.
- `connect` still proves the socket handles authenticated RPC with `server.getConfig`, but accepts a typed `EnvironmentAuthorizationError` answer, so credentials scoped without `orchestration:read` under upstream's `RPC_REQUIRED_SCOPES` can connect.
- The test `ServerConfig` fixture sets the new `observability.otlpLogsEnabled` field.
- `knip.jsonc` declares the `packages/sdk` workspace: its entry files, examples, and build script are entries, and entry exports are the public API (`includeEntryExports: false`).

## Validation Coverage

Client RPC mapping, cancellation, pairing, React connection lifecycle, package export shape and packed licenses, and an integration test against a real server started on a disposable home directory.
