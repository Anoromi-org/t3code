// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off -- Mirrors the learning service's plain fetch/Date client byte for byte.
/**
 * Learning-service contract.
 *
 * An external consumer, the personal learning service
 * (`~/code/experiments/learning-service`), drives T3 Code over plain HTTP. It
 * mints its own bearer session and wakes lesson threads with user messages:
 *
 *   - src/t3/cli.ts          `mint`: `t3 auth pairing create --base-dir <dir> --label
 *                            learning-service --ttl 5m --json`, then POST /oauth/token.
 *                            Rerun by systemd/learning-service-t3-renew.{timer,service}
 *                            every 20 days; `session` checks GET /api/auth/session.
 *   - src/t3/client.ts       exchangePairingToken, getThread (?turnLimit=1), isBusy, dispatch.
 *   - src/t3/credentials.ts  stores { token, scopes, expiresAt } from the exchange.
 *   - src/t3/wake.ts         the exact `thread.turn.start` command below; 404 means
 *                            "thread missing", 401/403 mean "auth", busy means retry.
 *
 * The requests in this file copy that client byte for byte (same headers, form
 * fields, paths and command shape). If one of these tests fails after a rebase
 * onto upstream, the learning service is broken too: fix T3 Code, or change the
 * learning service in the same step. The hyprnav slot-3 half of the contract is
 * pinned in apps/desktop/src/hyprnav/learningContract.test.ts.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentHttpApi,
  EnvironmentOrchestrationHttpApi,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { DEFAULT_SIGNAL_EXPORT } from "@t3tools/shared/observability";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/unstable/cli";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import { authHttpApiLayer, environmentAuthenticatedAuthLayer } from "./auth/http.ts";
import { cli } from "./bin.ts";
import * as ServerConfig from "./config.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import { orchestrationHttpApiLayer } from "./orchestration/http.ts";
import { OrchestrationLayerLive } from "./orchestration/runtimeLayer.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "./persistence/Layers/Sqlite.ts";
import * as ProjectCloneTracker from "./project/ProjectCloneTracker.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";
import * as WorkspacePaths from "./workspace/WorkspacePaths.ts";
import { codexThreadMcpArgs } from "./provider/Layers/codexLaunchArgs.ts";

const promise = <A>(thunk: () => Promise<A>) => Effect.promise(thunk);

// The two route groups the learning service calls, served by the production handlers.
class LearningContractHttpApi extends HttpApi.make("environment")
  .add(EnvironmentHttpApi.groups.auth)
  .add(EnvironmentOrchestrationHttpApi) {}

const LEARNING_SCOPES = ["orchestration:read", "orchestration:operate"];
const LESSON_PROJECT_ID = ProjectId.make("project-lessons");
const LESSON_THREAD_ID = ThreadId.make("thread-lesson");
const LESSON_MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Copy of learning-service src/t3/client.ts (keep in sync with that file).

type ThreadState = {
  id: string;
  title: string;
  modelSelection: { instanceId: string; model: string; [k: string]: unknown };
  runtimeMode: string;
  interactionMode: string;
  deletedAt: string | null;
  archivedAt: string | null;
  latestTurn: { turnId: string; state: "running" | "interrupted" | "completed" | "error" } | null;
  session: { status: string; activeTurnId: string | null } | null;
  messages?: ReadonlyArray<{ id: string; role: string; text: string }>;
};

type HttpResult = { readonly status: number; readonly body: string };

const call = (
  serverUrl: string,
  token: string,
  method: "GET" | "POST",
  pathname: string,
  body?: unknown,
): Promise<HttpResult> =>
  fetch(new URL(pathname, serverUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  }).then(async (res) => ({ status: res.status, body: await res.text() }));

const getThreadRaw = (serverUrl: string, token: string, threadId: string) =>
  call(
    serverUrl,
    token,
    "GET",
    `/api/orchestration/threads/${encodeURIComponent(threadId)}?turnLimit=1`,
  );

const dispatchRaw = (serverUrl: string, token: string, command: Record<string, unknown>) =>
  call(serverUrl, token, "POST", "/api/orchestration/dispatch", command);

function isBusy(t: ThreadState): string | null {
  if (t.session?.activeTurnId) return `session.activeTurnId=${t.session.activeTurnId}`;
  if (t.session && (t.session.status === "running" || t.session.status === "starting")) {
    return `session.status=${t.session.status}`;
  }
  if (t.latestTurn?.state === "running") return `latestTurn ${t.latestTurn.turnId} running`;
  return null;
}

/** The exact command wake.ts sends. */
const wakeCommand = (thread: ThreadState, threadId: string, text: string) => ({
  type: "thread.turn.start",
  commandId: NodeCrypto.randomUUID(),
  threadId,
  message: { messageId: NodeCrypto.randomUUID(), role: "user", text, attachments: [] },
  modelSelection: thread.modelSelection,
  runtimeMode: thread.runtimeMode,
  interactionMode: thread.interactionMode,
  createdAt: new Date().toISOString(),
});

const exchangePairingTokenRaw = (input: {
  serverUrl: string;
  pairingToken: string;
  scopes: string[];
  label: string;
}): Promise<HttpResult> => {
  const form = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: input.pairingToken,
    subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope: input.scopes.join(" "),
    client_label: input.label,
    client_device_type: "bot",
  });
  return fetch(new URL("/oauth/token", input.serverUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(10_000),
  }).then(async (res) => ({ status: res.status, body: await res.text() }));
};

// ---------------------------------------------------------------------------
// Fixture: a temp base dir, the production `t3` CLI for minting, and an
// in-process HTTP server with the real auth + orchestration stack on that dir.

const runCli = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    yield* Command.runWith(cli, { version: "0.0.0" })(args);
    return (
      (yield* TestConsole.logLines).findLast((line): line is string => typeof line === "string") ??
      ""
    );
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer)));

/** `node src/t3/cli.ts mint` up to the exchange: the CLI call and the field it reads. */
const mintPairingToken = (baseDir: string) =>
  Effect.gen(function* () {
    const out = yield* runCli([
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
    ]);
    const parsed = JSON.parse(out) as { credential?: unknown };
    assert.equal(typeof parsed.credential, "string");
    return parsed.credential as string;
  });

const makeConfig = (baseDir: string) =>
  Effect.gen(function* () {
    const derivedPaths = yield* ServerConfig.deriveServerPaths(baseDir, undefined);
    return {
      logLevel: "Error",
      traceMinLevel: "Info",
      traceTimingEnabled: true,
      traceBatchWindowMs: 200,
      traceMaxBytes: 10 * 1024 * 1024,
      traceMaxFiles: 10,
      otlpTracesUrl: undefined,
      otlpMetricsUrl: undefined,
      otlpLogsUrl: undefined,
      otlpTracesExport: DEFAULT_SIGNAL_EXPORT,
      otlpMetricsExport: DEFAULT_SIGNAL_EXPORT,
      otlpLogsExport: DEFAULT_SIGNAL_EXPORT,
      otlpServiceName: "t3-server",
      mode: "web",
      port: 0,
      host: "127.0.0.1",
      cwd: process.cwd(),
      baseDir,
      ...derivedPaths,
      staticDir: undefined,
      devUrl: undefined,
      devAllowedOrigins: [],
      noBrowser: true,
      startupPresentation: "browser",
      desktopBootstrapToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logWebSocketEvents: false,
      tailscaleServeEnabled: false,
      tailscaleServePort: 443,
    } satisfies ServerConfig.ServerConfig["Service"];
  });

interface PairResult {
  readonly access_token: string;
  readonly expires_in: number;
  readonly scope: string;
  readonly token_type: string;
}

interface ContractFixture {
  readonly baseDir: string;
  readonly serverUrl: string;
  readonly engine: OrchestrationEngine.OrchestrationEngineService["Service"];
  /** Mints through the CLI and exchanges, returning the parsed token response. */
  readonly pair: (
    scopes?: string[],
  ) => Effect.Effect<PairResult, Effect.Error<ReturnType<typeof mintPairingToken>>>;
}

const withContractServer = <A, E>(run: (fixture: ContractFixture) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-learning-contract-"));
    const workspaceRoot = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-learning-contract-ws-"),
    );
    const config = yield* makeConfig(baseDir);
    const routesLayer = HttpApiBuilder.layer(LearningContractHttpApi).pipe(
      Layer.provide(authHttpApiLayer),
      Layer.provide(
        orchestrationHttpApiLayer.pipe(
          Layer.provide(
            Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({
              get: () => Effect.succeed(null),
              discard: () => Effect.void,
            }),
          ),
        ),
      ),
      Layer.provide(environmentAuthenticatedAuthLayer),
    );
    const appLayer = HttpRouter.serve(routesLayer, {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provideMerge(
        EnvironmentAuth.layer.pipe(
          Layer.provideMerge(SqlitePersistenceLayerLive),
          Layer.provide(ServerEnvironment.identityLayer),
          Layer.provide(ServerSecretStore.layer),
        ),
      ),
      Layer.provideMerge(
        OrchestrationLayerLive.pipe(
          Layer.provideMerge(RepositoryIdentityResolver.layer),
          Layer.provideMerge(SqlitePersistenceLayerLive),
        ),
      ),
      Layer.provideMerge(Layer.mergeAll(WorkspacePaths.layer, ServerSecretStore.layer)),
      Layer.provideMerge(
        NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port: 0 }),
      ),
      Layer.provideMerge(NodeServices.layer),
      Layer.provide(ServerConfig.layer(config)),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const address = server.address;
        if (typeof address === "string" || !("port" in address)) {
          return assert.fail(`Expected TCP address, got ${String(address)}`);
        }
        const serverUrl = `http://127.0.0.1:${address.port}`;
        const engine = yield* OrchestrationEngine.OrchestrationEngineService;
        const createdAt = new Date().toISOString();
        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-learning-project"),
          projectId: LESSON_PROJECT_ID,
          title: "Lessons",
          workspaceRoot,
          createdAt,
        });
        yield* engine.dispatch({
          type: "thread.create",
          commandId: CommandId.make("cmd-learning-thread"),
          threadId: LESSON_THREAD_ID,
          projectId: LESSON_PROJECT_ID,
          title: "Learn: monads",
          modelSelection: LESSON_MODEL_SELECTION,
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: null,
          createdAt,
        });
        const pair = (scopes = LEARNING_SCOPES) =>
          Effect.gen(function* () {
            const pairingToken = yield* mintPairingToken(baseDir);
            const res = yield* promise(() =>
              exchangePairingTokenRaw({
                serverUrl,
                pairingToken,
                scopes,
                label: "learning-service",
              }),
            );
            assert.equal(res.status, 200, res.body);
            return JSON.parse(res.body) as PairResult;
          });
        return yield* run({ baseDir, serverUrl, engine, pair });
      }).pipe(Effect.provide(appLayer)),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          NodeFS.rmSync(baseDir, { recursive: true, force: true });
          NodeFS.rmSync(workspaceRoot, { recursive: true, force: true });
        }),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer));

// ---------------------------------------------------------------------------

describe("learning-service contract", () => {
  it.live("1. pairing: CLI-minted one-time token exchanges for a scoped bearer session", () =>
    withContractServer(({ baseDir, serverUrl }) =>
      Effect.gen(function* () {
        const pairingToken = yield* mintPairingToken(baseDir);
        const res = yield* promise(() =>
          exchangePairingTokenRaw({
            serverUrl,
            pairingToken,
            scopes: LEARNING_SCOPES,
            label: "learning-service",
          }),
        );
        assert.equal(res.status, 200, res.body);
        const body = JSON.parse(res.body) as Record<string, unknown>;
        assert.equal(typeof body.access_token, "string");
        assert.equal(body.token_type, "Bearer");
        assert.equal(body.scope, "orchestration:read orchestration:operate");
        assert.deepEqual(String(body.scope).split(" "), LEARNING_SCOPES);
        assert.equal(typeof body.expires_in, "number");

        // One-time: the same pairing token cannot be exchanged again.
        const reuse = yield* promise(() =>
          exchangePairingTokenRaw({
            serverUrl,
            pairingToken,
            scopes: LEARNING_SCOPES,
            label: "learning-service",
          }),
        );
        assert.equal(reuse.status, 401, reuse.body);
      }),
    ),
  );

  it.live("2. session: GET /api/auth/session reports the bearer session and its scopes", () =>
    withContractServer(({ serverUrl, pair }) =>
      Effect.gen(function* () {
        const issued = yield* pair();
        const res = yield* promise(() =>
          call(serverUrl, issued.access_token, "GET", "/api/auth/session"),
        );
        assert.equal(res.status, 200, res.body);
        const session = JSON.parse(res.body) as Record<string, unknown>;
        assert.equal(session.authenticated, true);
        assert.equal(session.sessionMethod, "bearer-access-token");
        assert.deepEqual(session.scopes, LEARNING_SCOPES);
        assert.equal(typeof session.expiresAt, "string");

        // A dead token still gets 200, only with authenticated=false. The learning
        // service's `cli.ts session` check must read the body, not just the status.
        const dead = yield* promise(() =>
          call(serverUrl, "not-a-token", "GET", "/api/auth/session"),
        );
        assert.equal(dead.status, 200, dead.body);
        assert.equal((JSON.parse(dead.body) as { authenticated: boolean }).authenticated, false);
      }),
    ),
  );

  it.live("3. read: thread snapshot carries every field wake.ts reads; unknown thread is 404", () =>
    withContractServer(({ serverUrl, pair }) =>
      Effect.gen(function* () {
        const { access_token } = yield* pair();
        const res = yield* promise(() => getThreadRaw(serverUrl, access_token, LESSON_THREAD_ID));
        assert.equal(res.status, 200, res.body);
        const snap = JSON.parse(res.body) as { snapshotSequence: unknown; thread: ThreadState };
        assert.equal(typeof snap.snapshotSequence, "number");
        const thread = snap.thread;
        assert.equal(thread.id, LESSON_THREAD_ID);
        assert.equal(thread.title, "Learn: monads");
        assert.deepEqual(thread.modelSelection, LESSON_MODEL_SELECTION);
        assert.equal(thread.runtimeMode, "full-access");
        assert.equal(thread.interactionMode, "default");
        assert.isNull(thread.deletedAt);
        assert.isNull(thread.archivedAt);
        assert.isTrue("latestTurn" in thread);
        assert.isTrue("session" in thread);
        assert.isNull(isBusy(thread));

        const missing = yield* promise(() =>
          getThreadRaw(serverUrl, access_token, "demo-learn-kit"),
        );
        assert.equal(missing.status, 404, missing.body);
        assert.equal((JSON.parse(missing.body) as { code: string }).code, "not_found");
      }),
    ),
  );

  it.live("4. dispatch: wake.ts thread.turn.start is accepted and the message lands", () =>
    withContractServer(({ serverUrl, pair }) =>
      Effect.gen(function* () {
        const { access_token } = yield* pair();
        const before = JSON.parse(
          (yield* promise(() => getThreadRaw(serverUrl, access_token, LESSON_THREAD_ID))).body,
        ) as { thread: ThreadState };
        const text = "[learning-service] review due: monads #3";
        const command = wakeCommand(before.thread, LESSON_THREAD_ID, text);
        const res = yield* promise(() => dispatchRaw(serverUrl, access_token, command));
        assert.equal(res.status, 200, res.body);
        const result = JSON.parse(res.body) as { sequence: unknown };
        assert.equal(typeof result.sequence, "number");

        const after = JSON.parse(
          (yield* promise(() => getThreadRaw(serverUrl, access_token, LESSON_THREAD_ID))).body,
        ) as { thread: ThreadState };
        const landed = after.thread.messages?.find(
          (message) => message.id === command.message.messageId,
        );
        assert.isDefined(landed);
        assert.equal(landed?.role, "user");
        assert.equal(landed?.text, text);
      }),
    ),
  );

  it.live("4b. busy: a running session is visible in the snapshot fields isBusy reads", () =>
    withContractServer(({ serverUrl, pair, engine }) =>
      Effect.gen(function* () {
        const { access_token } = yield* pair();
        const now = new Date().toISOString();
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-learning-session-running"),
          threadId: LESSON_THREAD_ID,
          createdAt: now,
          session: {
            threadId: LESSON_THREAD_ID,
            status: "running",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("turn-busy"),
            lastError: null,
            updatedAt: now,
          },
        });
        const busy = JSON.parse(
          (yield* promise(() => getThreadRaw(serverUrl, access_token, LESSON_THREAD_ID))).body,
        ) as { thread: ThreadState };
        assert.equal(busy.thread.session?.status, "running");
        assert.equal(busy.thread.session?.activeTurnId, "turn-busy");
        assert.equal(isBusy(busy.thread), "session.activeTurnId=turn-busy");

        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make("cmd-learning-session-ready"),
          threadId: LESSON_THREAD_ID,
          createdAt: now,
          session: {
            threadId: LESSON_THREAD_ID,
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: now,
          },
        });
        const idle = JSON.parse(
          (yield* promise(() => getThreadRaw(serverUrl, access_token, LESSON_THREAD_ID))).body,
        ) as { thread: ThreadState };
        assert.equal(idle.thread.session?.status, "ready");
        assert.isNull(idle.thread.session?.activeTurnId);
        assert.notEqual(idle.thread.latestTurn?.state, "running");
        assert.isNull(isBusy(idle.thread));
      }),
    ),
  );

  it.live("5. scopes: read-only cannot dispatch, operate-only cannot read (403)", () =>
    withContractServer(({ serverUrl, pair }) =>
      Effect.gen(function* () {
        const readOnly = yield* pair(["orchestration:read"]);
        assert.equal(readOnly.scope, "orchestration:read");
        const thread = JSON.parse(
          (yield* promise(() => getThreadRaw(serverUrl, readOnly.access_token, LESSON_THREAD_ID)))
            .body,
        ) as { thread: ThreadState };
        const denied = yield* promise(() =>
          dispatchRaw(
            serverUrl,
            readOnly.access_token,
            wakeCommand(thread.thread, LESSON_THREAD_ID, "should not land"),
          ),
        );
        assert.equal(denied.status, 403, denied.body);
        assert.deepInclude(JSON.parse(denied.body), {
          code: "insufficient_scope",
          requiredScope: "orchestration:operate",
        });

        const operateOnly = yield* pair(["orchestration:operate"]);
        const unreadable = yield* promise(() =>
          getThreadRaw(serverUrl, operateOnly.access_token, LESSON_THREAD_ID),
        );
        assert.equal(unreadable.status, 403, unreadable.body);
        assert.deepInclude(JSON.parse(unreadable.body), {
          code: "insufficient_scope",
          requiredScope: "orchestration:read",
        });

        // No token at all: wake.ts maps 401 to `auth:` and keeps retrying.
        const anonymous = yield* promise(() =>
          fetch(new URL(`/api/orchestration/threads/${LESSON_THREAD_ID}?turnLimit=1`, serverUrl)),
        );
        assert.equal(anonymous.status, 401);
      }),
    ),
  );

  it.live("6. renewal: re-mint issues a fresh 30-day session and keeps the old one valid", () =>
    withContractServer(({ serverUrl, pair }) =>
      Effect.gen(function* () {
        const first = yield* pair();
        const second = yield* pair();
        assert.notEqual(first.access_token, second.access_token);
        for (const issued of [first, second]) {
          // Bearer (non-DPoP) sessions default to 30 days; the timer renews at 20.
          assert.isAtLeast(issued.expires_in, THIRTY_DAYS_SECONDS - 120);
          assert.isAtMost(issued.expires_in, THIRTY_DAYS_SECONDS);
          const res = yield* promise(() =>
            call(serverUrl, issued.access_token, "GET", "/api/auth/session"),
          );
          const session = JSON.parse(res.body) as { authenticated: boolean; expiresAt: string };
          assert.equal(session.authenticated, true);
          const remainingSeconds = (Date.parse(session.expiresAt) - Date.now()) / 1000;
          assert.isAtLeast(remainingSeconds, THIRTY_DAYS_SECONDS - 120);
        }
      }),
    ),
  );

  it.live("7. slot 3: project.meta.update accepts the lesson-page hyprnav binding", () =>
    withContractServer(({ serverUrl, pair }) =>
      Effect.gen(function* () {
        const { access_token } = yield* pair();
        // learning-service slot/slot3-binding.json, applied the way its comment suggests.
        const hyprnav = {
          bindings: [
            {
              id: "lesson-page",
              slot: 3,
              scope: "thread",
              workspace: { mode: "managed" },
              name: "Lesson",
              action: "shell-command",
              command:
                "/home/anoromi/code/experiments/learning-service/slot/open-lesson {threadId}",
            },
          ],
        };
        const res = yield* promise(() =>
          dispatchRaw(serverUrl, access_token, {
            type: "project.meta.update",
            commandId: NodeCrypto.randomUUID(),
            projectId: LESSON_PROJECT_ID,
            hyprnav,
          }),
        );
        assert.equal(res.status, 200, res.body);
        const snapshot = yield* promise(() =>
          call(serverUrl, access_token, "GET", "/api/orchestration/snapshot"),
        );
        const project = (
          JSON.parse(snapshot.body) as {
            projects: ReadonlyArray<{ id: string; hyprnav?: unknown }>;
          }
        ).projects.find((candidate) => candidate.id === LESSON_PROJECT_ID);
        assert.deepEqual(project?.hyprnav, hyprnav);
      }),
    ),
  );

  it.live(
    "7b. agent env: Codex MCP servers receive T3CODE_THREAD_ID and T3CODE_ENVIRONMENT_ID",
    () =>
      Effect.sync(() => {
        assert.deepEqual(codexThreadMcpArgs("cua_repl", "thread-lesson", "env-1"), [
          "-c",
          'mcp_servers.cua_repl.env.T3CODE_THREAD_ID="thread-lesson"',
          "-c",
          'mcp_servers.cua_repl.env.T3CODE_ENVIRONMENT_ID="env-1"',
        ]);
      }),
  );
});
