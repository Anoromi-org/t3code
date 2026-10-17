// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Exercises the actual server CLI in a disposable directory.
import * as NodeNet from "node:net";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeEvents from "node:events";
import { it, expect } from "vite-plus/test";
import {
  connect,
  pair,
  CommandId,
  ProjectId,
  ThreadId,
  ORCHESTRATION_V2_WS_METHODS,
  WS_METHODS,
  type Client,
} from "./index.ts";
import * as Schema from "effect/Schema";
import { ProviderInstanceId, AuthPairingCredentialResult } from "@t3tools/contracts";

const decodeGrant = Schema.decodeUnknownSync(Schema.toCodecJson(AuthPairingCredentialResult));

it("creates a project and thread on a running T3 server and enforces read-only pairing", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-sdk-integration-"));
  const bin = NodeURL.fileURLToPath(new URL("../../../apps/server/src/bin.ts", import.meta.url));
  const reservation = NodeNet.createServer();
  reservation.listen(0, "127.0.0.1");
  await NodeEvents.EventEmitter.once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = NodeChildProcess.spawn(
    process.execPath,
    [bin, "--base-dir", directory, "--port", String(port), "--host", "127.0.0.1", "--no-browser"],
    {
      cwd: directory,
      env: {
        ...process.env,
        T3CODE_HOME: directory,
        T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
        VITE_DEV_SERVER_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = NodeEvents.EventEmitter.once(child, "exit");
  const clients: Client[] = [];
  try {
    const pairingUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/https?:\/\/[^\s"]+\/pair#token=[A-Za-z0-9._~%-]+/);
        if (match) resolve(match[0]);
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.once("error", reject);
      child.once("exit", () =>
        reject(
          new Error(
            `Test server exited before pairing: ${output.replace(/token=[^\s"]+/g, "token=REDACTED")}`,
          ),
        ),
      );
    });
    const credential = await pair({ pairingUrl });
    const client = await connect(credential);
    clients.push(client);
    const projectId = ProjectId.make("sdk-integration-project");
    const threadId = ThreadId.make("sdk-integration-thread");
    const stream = client.rpc[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({})[
      Symbol.asyncIterator
    ]();
    expect((await stream.next()).value?.kind).toBe("snapshot");
    await client.rpc[WS_METHODS.projectsMutate]({
      type: "project.create",
      commandId: CommandId.make("sdk-create-project"),
      projectId,
      title: "SDK integration",
      workspaceRoot: directory,
    });
    // Snapshots and synchronization markers can precede the update.
    const nextUpdate = async (kind: string) => {
      for (;;) {
        const item = await stream.next();
        if (item.done || item.value.kind === kind) return item.value;
      }
    };
    expect(await nextUpdate("project.updated")).toMatchObject({ project: { id: projectId } });
    await client.dispatchCommand({
      type: "thread.create",
      createdBy: "user",
      creationSource: "server",
      commandId: CommandId.make("sdk-create-thread"),
      projectId,
      threadId,
      title: "SDK thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
    });
    expect(await nextUpdate("thread.updated")).toMatchObject({
      thread: { id: threadId },
    });
    await stream.return?.();

    // Grant a read-only credential through the real administrative HTTP endpoint.
    const response = await fetch(`${credential.url}api/auth/pairing-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scopes: ["orchestration:read"] }),
    });
    const grant = decodeGrant(await response.json());
    const readonlyCredential = await pair({
      pairingUrl: `${credential.url}pair#token=${grant.credential}`,
      scopes: ["orchestration:read"],
    });
    const reader = await connect(readonlyCredential);
    clients.push(reader);
    await expect(
      reader.dispatchCommand({
        type: "thread.delete",
        commandId: CommandId.make("sdk-forbidden-delete"),
        threadId,
      }),
    ).rejects.toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredScope: "orchestration:operate",
    });
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    child.kill("SIGTERM");
    await exited;
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}, 30_000);
