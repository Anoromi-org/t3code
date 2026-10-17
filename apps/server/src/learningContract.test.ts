// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off preferSchemaOverJson:off -- Mirrors the learning service's plain fetch/WebSocket client against a real server process.
/**
 * Learning-service contract.
 *
 * An external consumer, the personal learning service
 * (`~/code/experiments/learning-service`), drives T3 Code from outside:
 *
 *   - src/t3/cli.ts      `mint`: `t3 auth pairing create --base-dir <dir> --label
 *                        learning-service --ttl 5m --json`, then POST /oauth/token;
 *                        `session` checks GET /api/auth/session.
 *   - src/t3/client.ts   getThread (GET .../threads/:id/bounded with the orchestration
 *                        protocol header), isBusy (an active run), and sendMessage
 *                        (`message.dispatch` over a ticketed /ws socket).
 *   - src/t3/wake.ts     404 means "thread missing", 401/403 and authorization
 *                        failures mean "auth", busy means retry.
 *
 * The requests here copy that client (headers, form fields, paths, frames, and
 * command shape). If a test fails after a rebase onto upstream, the learning
 * service is broken too: fix T3 Code, or change the service in the same step.
 * The hyprnav slot-3 half is pinned in apps/desktop/src/hyprnav/learningContract.test.ts.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

const BIN = NodeURL.fileURLToPath(new URL("./bin.ts", import.meta.url));
const SCOPES = ["orchestration:read", "orchestration:operate"];
const PROTOCOL = { header: "x-t3-orchestration-protocol", query: "orchestrationProtocol" };
const ACTIVE_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);

let baseDir = "";
let serverUrl = "";
let server: NodeChildProcess.ChildProcess | undefined;

function cli(args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync(process.execPath, [BIN, ...args], {
    cwd: baseDir,
    env: { ...process.env, T3CODE_HOME: baseDir },
    encoding: "utf8",
  });
}

/** `node src/t3/cli.ts mint` up to the exchange: the CLI call and the field it reads. */
function mintPairingToken(scopes?: ReadonlyArray<string>): string {
  const out = cli([
    "auth",
    "pairing",
    "create",
    "--base-dir",
    baseDir,
    "--label",
    "learning-service",
    "--ttl",
    "5m",
    "--json",
    ...(scopes ?? []).flatMap((scope) => ["--scope", scope]),
  ]);
  const parsed = JSON.parse(out) as { credential?: unknown };
  expect(typeof parsed.credential).toBe("string");
  return parsed.credential as string;
}

/** client.ts exchangePairingToken. */
async function exchange(pairingToken: string, scopes = SCOPES) {
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: pairingToken,
    subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope: scopes.join(" "),
    client_label: "learning-service",
    client_device_type: "bot",
  });
  return fetch(new URL("/oauth/token", serverUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

async function bearer(scopes = SCOPES): Promise<string> {
  const res = await exchange(mintPairingToken(scopes), scopes);
  expect(res.status).toBe(200);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** client.ts call(). */
function call(token: string | null, method: "GET" | "POST", pathname: string, body?: unknown) {
  return fetch(new URL(pathname, serverUrl), {
    method,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      [PROTOCOL.header]: "2",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type RpcExit =
  | { readonly _tag: "Success"; readonly value: unknown }
  | {
      readonly _tag: "Failure";
      readonly cause: ReadonlyArray<{ readonly error?: Record<string, unknown> }>;
    };

/** client.ts rpc(): one request over a fresh, ticket-authenticated socket. */
async function rpc(token: string, tag: string, payload: unknown): Promise<RpcExit> {
  const ticketRes = await call(token, "POST", "/api/auth/websocket-ticket");
  expect(ticketRes.status).toBe(200);
  const { ticket } = (await ticketRes.json()) as { ticket: string };
  const url = new URL("/ws", serverUrl);
  url.protocol = "ws:";
  url.searchParams.set("wsTicket", ticket);
  url.searchParams.set(PROTOCOL.query, "2");
  const socket = new WebSocket(url);
  try {
    return await new Promise<RpcExit>((resolve, reject) => {
      socket.addEventListener("open", () =>
        socket.send(JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] })),
      );
      socket.addEventListener("close", () => reject(new Error(`${tag}: socket closed`)));
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data)) as {
          _tag?: string;
          requestId?: string;
          exit?: RpcExit;
        };
        if (message._tag === "Ping") socket.send(JSON.stringify({ _tag: "Pong" }));
        if (message._tag === "Exit" && message.requestId === "1" && message.exit) {
          resolve(message.exit);
        }
      });
    });
  } finally {
    socket.close();
  }
}

/** client.ts sendMessage. */
const messageDispatch = (threadId: string, text: string, modelSelection?: unknown) => ({
  type: "message.dispatch",
  createdBy: "user",
  creationSource: "server",
  commandId: NodeCrypto.randomUUID(),
  threadId,
  messageId: NodeCrypto.randomUUID(),
  text,
  attachments: [],
  ...(modelSelection === undefined ? {} : { modelSelection }),
  dispatchMode: { type: "start_immediately" },
});

type BoundedSnapshot = {
  readonly projection: {
    readonly thread: {
      readonly id: string;
      readonly title: string;
      readonly modelSelection: unknown;
      readonly archivedAt: string | null;
    };
    readonly runs: ReadonlyArray<{ readonly id: string; readonly status: string }>;
    readonly messages: ReadonlyArray<{ readonly role: string; readonly text: string }>;
  };
};

async function readThread(token: string | null, threadId: string) {
  return call(token, "GET", `/api/orchestration/threads/${encodeURIComponent(threadId)}/bounded`);
}

const projectId = "learning-contract-project";
const threadId = "learning-contract-thread";

beforeAll(async () => {
  baseDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-learning-contract-"));
  const reservation = NodeNet.createServer();
  reservation.listen(0, "127.0.0.1");
  await NodeEvents.EventEmitter.once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  serverUrl = `http://127.0.0.1:${address.port}`;
  const child = NodeChildProcess.spawn(
    process.execPath,
    [
      BIN,
      "--base-dir",
      baseDir,
      "--port",
      String(address.port),
      "--host",
      "127.0.0.1",
      "--no-browser",
    ],
    {
      cwd: baseDir,
      env: {
        ...process.env,
        T3CODE_HOME: baseDir,
        T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
        VITE_DEV_SERVER_URL: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server = child;
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (/\/pair#token=/.test(output)) resolve();
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("exit", () => reject(new Error(`Server exited before starting:\n${output}`)));
  });

  const token = await bearer();
  const project = await call(token, "POST", "/api/projects/mutate", {
    type: "project.create",
    commandId: NodeCrypto.randomUUID(),
    projectId,
    title: "Lessons",
    workspaceRoot: baseDir,
  });
  expect(project.status).toBe(200);
  const created = await rpc(token, "orchestration.dispatchCommand", {
    type: "thread.create",
    createdBy: "user",
    creationSource: "server",
    commandId: NodeCrypto.randomUUID(),
    threadId,
    projectId,
    title: "Lesson thread",
    modelSelection: { instanceId: "codex", model: "gpt-5.4" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
  });
  expect(created._tag).toBe("Success");
}, 60_000);

afterAll(async () => {
  if (server && server.exitCode === null) {
    const exited = NodeEvents.EventEmitter.once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  await NodeFSP.rm(baseDir, { recursive: true, force: true });
});

describe("learning service contract", () => {
  it("exchanges a CLI-minted pairing token once for a scoped bearer session", async () => {
    const pairingToken = mintPairingToken();
    const res = await exchange(pairingToken);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe(SCOPES.join(" "));
    expect(typeof body.expires_in).toBe("number");
    expect((await exchange(pairingToken)).status).toBe(401);

    const session = await fetch(new URL("/api/auth/session", serverUrl), {
      headers: { authorization: `Bearer ${body.access_token as string}` },
    });
    expect(await session.json()).toMatchObject({
      authenticated: true,
      sessionMethod: "bearer-access-token",
      scopes: expect.arrayContaining(SCOPES),
    });
    const dead = await fetch(new URL("/api/auth/session", serverUrl), {
      headers: { authorization: "Bearer not-a-token" },
    });
    expect(dead.status).toBe(200);
    expect(await dead.json()).toMatchObject({ authenticated: false });
  });

  it("reads the thread fields getThread and isBusy use, and 404s a missing thread", async () => {
    const token = await bearer();
    const res = await readThread(token, threadId);
    expect(res.status).toBe(200);
    const snapshot = (await res.json()) as BoundedSnapshot;
    expect(snapshot.projection.thread).toMatchObject({
      id: threadId,
      title: "Lesson thread",
      modelSelection: { instanceId: "codex", model: "gpt-5.4" },
      archivedAt: null,
    });
    expect(snapshot.projection.runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))).toBe(false);
    expect((await readThread(token, "missing-thread")).status).toBe(404);
  });

  it("starts a turn with message.dispatch over a ticketed socket", async () => {
    const token = await bearer();
    const exit = await rpc(
      token,
      "orchestration.dispatchCommand",
      messageDispatch(threadId, "Time for your lesson.", { instanceId: "codex", model: "gpt-5.4" }),
    );
    expect(exit).toMatchObject({ _tag: "Success", value: { sequence: expect.any(Number) } });
    const snapshot = (await (await readThread(token, threadId)).json()) as BoundedSnapshot;
    expect(snapshot.projection.messages).toContainEqual(
      expect.objectContaining({ role: "user", text: "Time for your lesson." }),
    );
    expect(snapshot.projection.runs.length).toBeGreaterThan(0);
  });

  it("enforces the scopes the service is minted with", async () => {
    const readOnly = await bearer(["orchestration:read"]);
    const denied = await rpc(
      readOnly,
      "orchestration.dispatchCommand",
      messageDispatch(threadId, "not allowed"),
    );
    expect(denied._tag).toBe("Failure");
    expect(denied._tag === "Failure" ? denied.cause[0]?.error : undefined).toMatchObject({
      _tag: "EnvironmentAuthorizationError",
      requiredScope: "orchestration:operate",
    });
    const operateOnly = await bearer(["orchestration:operate"]);
    expect((await readThread(operateOnly, threadId)).status).toBe(403);
    expect((await readThread(null, threadId)).status).toBe(401);
  });

  it("renews with a fresh 30-day token and keeps the earlier session valid", async () => {
    const first = await bearer();
    const res = await exchange(mintPairingToken(SCOPES));
    const renewed = (await res.json()) as { access_token: string; expires_in: number };
    expect(renewed.access_token).not.toBe(first);
    expect(renewed.expires_in).toBe(30 * 24 * 60 * 60);
    const session = await fetch(new URL("/api/auth/session", serverUrl), {
      headers: { authorization: `Bearer ${first}` },
    });
    expect(await session.json()).toMatchObject({ authenticated: true });
  });

  it("stores the slot-3 lesson binding through projects mutate unchanged", async () => {
    // learning-service slot/slot3-binding.json, `hyprnav` member, slot 3 verbatim.
    const binding = {
      hyprnav: {
        bindings: [
          {
            id: "lesson-page",
            slot: 3,
            scope: "thread",
            workspace: { mode: "managed" },
            name: "Lesson",
            action: "shell-command",
            command: "/home/anoromi/code/experiments/learning-service/slot/open-lesson {threadId}",
          },
        ],
      },
    };
    const token = await bearer();
    const res = await call(token, "POST", "/api/projects/mutate", {
      type: "project.update",
      commandId: NodeCrypto.randomUUID(),
      projectId,
      hyprnav: binding.hyprnav,
    });
    expect(res.status).toBe(200);
    const stored = (await res.json()) as { hyprnav?: { bindings: ReadonlyArray<unknown> } };
    expect(stored.hyprnav?.bindings).toEqual(binding.hyprnav.bindings);
  });
});
