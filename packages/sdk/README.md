# T3 Code SDK

Connect a Node 24+ tool or browser app to an existing T3 Code environment. The SDK exposes every WebSocket RPC in the server contracts, including all client orchestration commands. It does not start a server or a provider.

```ts
import { connect, ORCHESTRATION_WS_METHODS } from "@anoromi/t3code-sdk";

const t3 = await connect({ url: "http://localhost:3773", token });
try {
  for await (const item of t3.rpc[ORCHESTRATION_WS_METHODS.subscribeShell]({})) {
    if (item.kind !== "snapshot") continue;
    console.log(item.snapshot.projects);
    break;
  }
} finally {
  await t3.close();
}
```

## Pairing

Use `t3 auth session issue --token-only` on the environment to issue a bearer token, or exchange a one-time pairing link:

```ts
import { pair, connect } from "@anoromi/t3code-sdk";

const credential = await pair({
  pairingUrl,
  label: "My integration",
  scopes: ["orchestration:read", "orchestration:operate"],
});
await saveCredential(credential);
const t3 = await connect(credential);
```

Save the credential before connecting. The pairing link has already been consumed even if the subsequent connection fails. The SDK keeps credentials in memory; your app chooses persistent storage. Scopes cannot exceed those granted by the pairing link. The environment can revoke the resulting session through its existing connection management.

## Commands and streams

`t3.rpc` uses the existing method names, with typed inputs and results. Import `WS_METHODS` and `ORCHESTRATION_WS_METHODS` for autocomplete. `@anoromi/t3code-sdk/contracts` exports the matching schemas, types, and branded ID constructors for advanced calls. Ordinary RPCs return promises; subscriptions and streaming commands return async iterables. Breaking iteration cancels the stream. Both accept `{ signal }` to cancel work.

`t3.dispatchCommand` is a convenience alias for `t3.rpc[ORCHESTRATION_WS_METHODS.dispatchCommand]`:

```ts
import { CommandId, ProjectId } from "@anoromi/t3code-sdk";

const receipt = await t3.dispatchCommand({
  type: "project.create",
  commandId: CommandId.make(crypto.randomUUID()),
  projectId: ProjectId.make(crypto.randomUUID()),
  title: "My project",
  workspaceRoot: "/path/on/the/server",
  createdAt: new Date().toISOString(),
});
```

The returned sequence acknowledges dispatch. It does not mean an agent turn or its side effects have finished. Subscribe to thread updates to observe those outcomes. Paths refer to the environment's filesystem. Provider-specific requests use that environment's configured provider instances. Desktop shell operations require an appropriate connected desktop host.

## Connection lifetime and compatibility

`connect` validates authentication and loads server configuration before returning. Its optional `signal` and `timeoutMs` apply to connection setup. `close()` is idempotent, cancels active requests and streams, and resolves `closed` after cleanup. Transport loss also resolves `closed`.

Reconnect explicitly with a new `connect` call. Each connection gets a fresh WebSocket ticket. Failed requests and streaming commands are never replayed automatically: a command may have executed even if its response was lost. Reconcile state before deciding whether to retry, and preserve command IDs for an intentional retry.

After reconnecting, subscribe without a cursor for a fresh snapshot and replace your cached state. For protocols that support it, pass the last applied sequence to resume. The SDK does not merge snapshots, deduplicate events, or promise replay for ephemeral streams such as terminal output.

This initial SDK follows the contracts bundled with its build. Use a matching server revision. Server permission errors retain their structured fields; unsupported or incompatible responses reject through the transport/schema error. There is no cross-version capability negotiation yet. Use `skipLibCheck: true` with the current Effect beta, which has an upstream declaration error.

Direct remote and tunnel origins use the same bearer flow. Managed relay integrations can provide `authorize({ signal })`, which must return a freshly authorized WebSocket URL using their existing relay credentials. The SDK does not perform T3 Connect account sign-in. Optional `fetch` and `webSocket` factories support host-specific transports.

Browser requests must satisfy the environment's CORS policy and the browser's HTTPS/mixed-content rules. Development integrations can use the existing Vite proxy or configure the server's `T3CODE_DEV_ALLOWED_ORIGINS`.

## Shared React component

```tsx
import { createConnection } from "@anoromi/t3code-sdk";
import { T3Connect, useT3Connection } from "@anoromi/t3code-sdk/react";
import "@anoromi/t3code-sdk/style.css";

const connection = createConnection({ saveCredential });

function Integration() {
  const state = useT3Connection(connection);
  // state.client is available when state.status === "connected".
  return <T3Connect connection={connection} />;
}
```

The component uses a pairing-link form and provides cancellation, status, reconnect, and disconnect. It inherits typography and T3 theme variables, with browser colors as fallbacks. React is optional for headless consumers.

The app owns the controller. Call `connection.disconnect()` when disposing it. Disconnect closes the socket and forgets its in-memory credential; it does not revoke the server session or delete your app's saved credential. Restore saved credentials with `connection.connect(credential)`. Inspect `state.error` for diagnostic details after a failure. A hosted approval page and redirect-based connection flow are not included.

## Development

From `packages/sdk`:

```sh
vp run build
vp test run
vp exec tsgo --noEmit
npm pack ./dist --pack-destination /tmp
```

The build bundles workspace runtime code and emits local contract declarations, so consumers do not need the private workspace packages. The tested Effect runtime is bundled, including T3’s RPC heartbeat patch. Effect remains a version-pinned dependency for declaration types. The `dist` manifest pins the installed Effect version and omits private workspace dependencies. Pack that directory. Nothing is published by the build.

Run `T3_URL=... T3_TOKEN=... node examples/node.ts` after building for a project listing. `vp dev` serves the React example in `index.html`; paste a fresh pairing link from a reachable environment. For a development environment on another origin, configure its allowed origins first.

Tests cover HTTP/WebSocket behavior, stream cancellation, lost responses, connection ownership, React pairing, and a disposable real server with scoped authorization. They do not invoke provider turns or use the live T3 database.

## Publishing to npm

Build from this repository with its workspace dependencies installed. From `packages/sdk`, set the release version in `package.json` and authenticate with npm using an account that can publish `@anoromi/t3code-sdk`.

```sh
vp test run
vp exec tsgo --noEmit
npm run pack:npm
npm run publish:npm -- --dry-run
# Once you have inspected the tarball and authenticated with npm:
npm run publish:npm
```

Both commands rebuild first. `pack:npm` writes a tarball in this directory; `publish:npm` publishes the generated `dist` package with public access. Extra npm flags, such as `--tag next` or `--otp`, can follow `--`. Bump the source version before each release.

The workspace manifest is private because it contains workspace and catalog dependencies. The generated manifest is publishable and includes resolved dependencies, package metadata, and license files. Do not publish the workspace directory directly.
