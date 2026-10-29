import * as NodeOS from "node:os";

import {
  CodexSettings,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  defaultInstanceIdForDriver,
  MessageId,
  type OrchestrationV2Run,
  type OrchestrationV2StoredEvent,
  type ProjectId,
  ProviderDriverKind,
  ProviderSessionId,
  type ProviderInstanceId,
  type RunId,
  ThreadId,
  VoiceSessionError,
  VoiceSessionId,
  type VoiceStartInput,
  type VoiceStartResult,
  type VoiceStopInput,
} from "@t3tools/contracts";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as HostProcess from "@t3tools/shared/HostProcess";
import type * as CodexClient from "effect-codex-app-server/client";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as CodexAdapterV2 from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import { buildCodexInitializeParams } from "../provider/CodexProvider.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { deriveProviderInstanceConfigMap } from "../provider/ProviderInstanceRegistryHydration.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  buildLunaInstructions,
  buildOpusFinishedMessage,
  buildVoicePrompt,
  DELEGATE_TOOL_NAME,
  DELEGATE_TOOL_SPEC,
} from "./voicePrompts.ts";

const LUNA_MODEL = "gpt-6-luna";
const OPUS_MODEL = "claude-opus-5-5";
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
// GPT-Live bills per connected minute, silence included.
const VOICE_IDLE_TIMEOUT = Duration.seconds(60);
const SDP_ANSWER_TIMEOUT = Duration.seconds(20);
const REALTIME_STOP_TIMEOUT = Duration.seconds(5);
const OPUS_RESULT_MAX_CHARS = 6000;

const decodeCodexSettings = Schema.decodeUnknownOption(CodexSettings);
const DEFAULT_CODEX_SETTINGS = Schema.decodeSync(CodexSettings)({});
const decodeThreadResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) }),
);
export function parseDelegateTask(args: unknown): string | undefined {
  let value = args;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (value === null || typeof value !== "object" || !("task" in value)) return undefined;
  const task = typeof value.task === "string" ? value.task.trim() : "";
  return task.length > 0 ? task : undefined;
}

export function truncateOpusResult(text: string, maxChars = OPUS_RESULT_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "(Opus left no final message.)";
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\n[truncated]`;
}

/** Completes once nothing happened for `idleTimeout` while `busy` was false. */
export const waitForIdle = (input: {
  readonly idleTimeout: Duration.Input;
  readonly lastActivityAt: Effect.Effect<number>;
  readonly busy: Effect.Effect<boolean>;
}): Effect.Effect<void> =>
  Effect.gen(function* () {
    const idleMs = Duration.toMillis(Duration.fromInputUnsafe(input.idleTimeout));
    while (true) {
      const remaining = (yield* input.lastActivityAt) + idleMs - (yield* Clock.currentTimeMillis);
      if (remaining > 0) {
        yield* Effect.sleep(Duration.millis(remaining));
      } else if (yield* input.busy) {
        // The turn's own completion counts as activity, so the clock restarts then.
        yield* Effect.sleep(Duration.millis(idleMs));
      } else {
        return;
      }
    }
  });

/**
 * Reports each run once when it finishes, and calls `onActive` while one is unfinished.
 * Runs can repeat `run.updated` after finishing, so finished ones are deduplicated.
 */
export const relayFinishedRuns = <E, R>(input: {
  readonly events: Stream.Stream<OrchestrationV2StoredEvent, E, R>;
  readonly onActive: (run: OrchestrationV2Run) => Effect.Effect<void>;
  readonly onFinished: (run: OrchestrationV2Run) => Effect.Effect<void>;
}): Effect.Effect<void, E, R> => {
  const reported = new Set<RunId>();
  return input.events.pipe(
    Stream.runForEach(({ event }) => {
      if (event.type !== "run.updated") return Effect.void;
      const run = event.payload;
      if (!ThreadManagement.isTerminalRunStatus(run.status)) return input.onActive(run);
      if (reported.has(run.id)) return Effect.void;
      reported.add(run.id);
      return input.onFinished(run);
    }),
  );
};

function osUserFirstName(): string {
  try {
    return NodeOS.userInfo().username;
  } catch {
    return "there";
  }
}

interface LiveSession {
  readonly id: VoiceSessionId;
  readonly projectId: ProjectId;
  readonly scope: Scope.Closeable;
  readonly client: CodexClient.CodexAppServerClient["Service"];
  readonly delegateLock: Semaphore.Semaphore;
  lunaThreadId: string | undefined;
  workThread: { readonly threadId: ThreadId; readonly title: string } | undefined;
  activeLunaTurnId: string | undefined;
  lastActivityAt: number;
  closed: boolean;
}

const voiceError = (message: string) => (cause: unknown) =>
  new VoiceSessionError({ message, cause });

export class VoiceSessionService extends Context.Service<
  VoiceSessionService,
  {
    readonly start: (input: VoiceStartInput) => Effect.Effect<VoiceStartResult, VoiceSessionError>;
    readonly stop: (input: VoiceStopInput) => Effect.Effect<void, VoiceSessionError>;
  }
>()("t3/voice/VoiceSessionService") {}

const make = Effect.gen(function* () {
  const clientFactory = yield* CodexAdapterV2.CodexAppServerClientFactory;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threadManagement = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const path = yield* Path.Path;
  const hostEnvironment = yield* HostProcess.Environment;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  // Opus results must land in Luna's thread after the call that asked for them ends.
  const serviceScope = yield* Scope.Scope;

  const lifecycle = yield* Semaphore.make(1);
  let current: LiveSession | undefined;
  // Luna is the voice user's memory, so one Codex thread per project outlives calls.
  const lunaThreads = new Map<ProjectId, string>();
  const pendingResults = new Map<ProjectId, Array<string>>();
  const followedThreads = new Set<ThreadId>();
  // Unfinished Opus runs → project, so a call stays open while its project's work runs.
  const activeRuns = new Map<RunId, ProjectId>();

  const touch = (session: LiveSession) =>
    Clock.currentTimeMillis.pipe(
      Effect.map((now) => {
        session.lastActivityAt = now;
      }),
    );

  const closeSession = (session: LiveSession) =>
    Effect.gen(function* () {
      if (session.closed) return;
      session.closed = true;
      if (current === session) current = undefined;
      if (session.lunaThreadId !== undefined) {
        yield* session.client.raw
          .request("thread/realtime/stop", { threadId: session.lunaThreadId })
          .pipe(Effect.timeout(REALTIME_STOP_TIMEOUT), Effect.ignore);
      }
      yield* Scope.close(session.scope, Exit.void);
    });

  // Callers inside the session scope (notification handlers, the idle timer)
  // would interrupt themselves mid-teardown, so teardown runs in the service scope.
  const closeSessionDetached = (session: LiveSession) =>
    closeSession(session).pipe(Effect.forkIn(serviceScope), Effect.asVoid);

  const resolveCodexClientInput = Effect.gen(function* () {
    const settings = yield* serverSettings.getSettings;
    const instanceId = CodexAdapterV2.CODEX_DEFAULT_INSTANCE_ID;
    const instance = deriveProviderInstanceConfigMap(settings)[instanceId];
    const config = Option.getOrElse(
      decodeCodexSettings(instance?.config ?? {}),
      () => DEFAULT_CODEX_SETTINGS,
    );
    const layout = yield* resolveCodexHomeLayout(config).pipe(
      Effect.provideService(Path.Path, path),
      Effect.provideService(HostProcess.HomeDirectory, homeDirectory),
    );
    const environment = yield* mergeProviderInstanceEnvironment(
      instance?.environment,
      hostEnvironment,
    );
    return {
      instanceId,
      settings: {
        ...config,
        binaryPath: expandHomePath(config.binaryPath, homeDirectory),
        homePath: layout.effectiveHomePath ?? "",
      } satisfies CodexSettings,
      environment,
    };
  });

  const resolveClaudeInstance = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const providers = yield* providerRegistry.getProviders;
      const preferred = defaultInstanceIdForDriver(CLAUDE_DRIVER);
      const candidates = providers
        .filter((provider) => provider.driver === CLAUDE_DRIVER && provider.enabled)
        .toSorted(
          (left, right) =>
            Number(right.instanceId === preferred) - Number(left.instanceId === preferred),
        );
      for (const candidate of candidates) {
        if (
          yield* threadManagement.isProviderInstanceEnabledForProject({
            projectId,
            instanceId: candidate.instanceId,
          })
        ) {
          return candidate.instanceId;
        }
      }
      return undefined;
    });

  const lunaTurnText = (text: string) => [{ type: "text" as const, text, text_elements: [] }];

  const sendToLuna = (session: LiveSession, text: string) =>
    Effect.gen(function* () {
      const threadId = session.lunaThreadId;
      if (threadId === undefined) return yield* Effect.fail("luna thread not ready");
      const activeTurnId = session.activeLunaTurnId;
      if (activeTurnId !== undefined) {
        const steered = yield* session.client
          .request("turn/steer", {
            threadId,
            expectedTurnId: activeTurnId,
            input: lunaTurnText(text),
          })
          .pipe(Effect.exit);
        // The turn may have ended between the notification and the steer.
        if (Exit.isSuccess(steered)) return;
      }
      yield* session.client.request("turn/start", { threadId, input: lunaTurnText(text) });
    });

  const queueResult = (projectId: ProjectId, text: string) =>
    Effect.sync(() => {
      const queue = pendingResults.get(projectId) ?? [];
      queue.push(text);
      pendingResults.set(projectId, queue);
    });

  const deliverResult = (projectId: ProjectId, text: string) =>
    Effect.gen(function* () {
      const session = current;
      if (session === undefined || session.closed || session.projectId !== projectId) {
        return yield* queueResult(projectId, text);
      }
      yield* sendToLuna(session, text).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Voice: could not wake Luna; keeping the result for the next call.", {
            cause,
          }).pipe(Effect.andThen(queueResult(projectId, text))),
        ),
      );
    });

  const flushPendingResults = (session: LiveSession) =>
    Effect.gen(function* () {
      const queued = pendingResults.get(session.projectId);
      if (queued === undefined || queued.length === 0) return;
      pendingResults.delete(session.projectId);
      yield* sendToLuna(session, queued.join("\n\n")).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Voice: could not deliver queued Opus results.", { cause }).pipe(
            Effect.andThen(
              Effect.sync(() => {
                pendingResults.set(session.projectId, [
                  ...queued,
                  ...(pendingResults.get(session.projectId) ?? []),
                ]);
              }),
            ),
          ),
        ),
      );
    });

  const reportRun = (projectId: ProjectId, threadId: ThreadId, run: OrchestrationV2Run) =>
    Effect.gen(function* () {
      const records = yield* threadManagement.getProjectThreadRecords(
        { projectId, threadId },
        ["messages"],
        { messageRunIds: [run.id], messageRoles: ["assistant"] },
      );
      const finalMessage = records.messages
        .filter((message) => message.text.trim().length > 0)
        .toSorted(
          (left, right) =>
            DateTime.toEpochMillis(left.createdAt) - DateTime.toEpochMillis(right.createdAt),
        )
        .at(-1);
      yield* deliverResult(
        projectId,
        buildOpusFinishedMessage({
          threadTitle: records.thread.title,
          status: run.status,
          result: truncateOpusResult(finalMessage?.text ?? ""),
        }),
      );
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Voice: reading an Opus result failed.", { cause }).pipe(
          Effect.andThen(
            deliverResult(
              projectId,
              buildOpusFinishedMessage({
                threadTitle: "the Opus thread",
                status: run.status,
                result: "T3 Code could not read the result. Check the thread.",
              }),
            ),
          ),
        ),
      ),
    );

  /**
   * Relays every Opus run that finishes on the thread, not only the ones voice
   * started: background sub-agents wake Opus in new runs, often after the call ended.
   * Runs already finished at `afterSequence` are not reported again.
   */
  const followThread = (input: {
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly afterSequence: number;
  }) =>
    Effect.gen(function* () {
      if (followedThreads.has(input.threadId)) return;
      followedThreads.add(input.threadId);
      yield* relayFinishedRuns({
        events: threadManagement.streamStoredEventsFrom({
          threadId: input.threadId,
          afterSequence: input.afterSequence,
          eventType: "run.updated",
        }),
        onActive: (run) => Effect.sync(() => activeRuns.set(run.id, input.projectId)),
        onFinished: (run) =>
          Effect.sync(() => activeRuns.delete(run.id)).pipe(
            Effect.andThen(reportRun(input.projectId, input.threadId, run)),
          ),
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Voice: following the Opus thread stopped.", { cause }),
        ),
        Effect.ensuring(Effect.sync(() => followedThreads.delete(input.threadId))),
        Effect.forkIn(serviceScope),
      );
    });

  const delegate = (session: LiveSession, callId: string, task: string) =>
    Effect.gen(function* () {
      const key = `voice:${session.lunaThreadId ?? session.id}:${callId}`;
      const commandId = CommandId.make(`${key}:command`);
      const messageId = MessageId.make(`${key}:message`);
      const provenance = { createdBy: "user", creationSource: "web" } as const;
      const work = session.workThread;
      if (work !== undefined) {
        // Taken before sending, so the run this message starts or steers is still seen.
        const afterSequence = yield* threadManagement.getThreadEventSequence(work.threadId);
        yield* threadManagement.sendToThread({
          projectId: session.projectId,
          commandId,
          threadId: work.threadId,
          messageId,
          text: task,
          attachments: [],
          mode: "auto",
          ...provenance,
        });
        yield* followThread({
          projectId: session.projectId,
          threadId: work.threadId,
          afterSequence,
        });
        return work.title;
      }
      const instanceId: ProviderInstanceId | undefined = yield* resolveClaudeInstance(
        session.projectId,
      );
      if (instanceId === undefined) {
        return yield* Effect.fail("No enabled Claude provider instance for this project.");
      }
      const launched = yield* threadLaunch.launch({
        commandId,
        projectId: session.projectId,
        title: task.length > 60 ? `${task.slice(0, 57)}...` : task,
        generateTitle: true,
        modelSelection: { instanceId, model: OPUS_MODEL },
        runtimeMode: DEFAULT_RUNTIME_MODE,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        workspaceStrategy: { type: "root" },
        initialMessage: { messageId, text: task, attachments: [] },
        ...provenance,
      });
      const title = launched.projection.thread.title;
      session.workThread = { threadId: launched.threadId, title };
      yield* followThread({
        projectId: session.projectId,
        threadId: launched.threadId,
        afterSequence: 0,
      });
      return title;
    });

  const handleToolCall = (session: LiveSession, params: CodexToolCall) =>
    Effect.gen(function* () {
      yield* touch(session);
      if (params.tool !== DELEGATE_TOOL_NAME) {
        return toolResponse(false, `Unknown tool "${params.tool}".`);
      }
      const task = parseDelegateTask(params.arguments);
      if (task === undefined) {
        return toolResponse(false, "delegate_to_opus needs a non-empty `task` string.");
      }
      const outcome = yield* session.delegateLock
        .withPermit(delegate(session, params.callId, task))
        .pipe(Effect.exit);
      if (Exit.isFailure(outcome)) {
        yield* Effect.logWarning("Voice: delegation to Opus failed.", { cause: outcome.cause });
        const reason = Option.filter(Cause.findErrorOption(outcome.cause), Predicate.isString);
        return toolResponse(
          false,
          `Could not hand the task to Opus${Option.isSome(reason) ? `: ${reason.value}` : "."} Tell the user it failed.`,
        );
      }
      return toolResponse(
        true,
        `Sent to Opus (thread "${outcome.value}"). The result will arrive as a new message.`,
      );
    });

  const ensureLunaThread = (
    session: LiveSession,
    project: { readonly title: string; readonly workspaceRoot: string },
  ) =>
    Effect.gen(function* () {
      const threadSettings = {
        cwd: project.workspaceRoot,
        model: LUNA_MODEL,
        approvalPolicy: "never",
        sandbox: "read-only",
        config: { model_reasoning_effort: "low" },
        developerInstructions: buildLunaInstructions(project.title),
      };
      const existing = lunaThreads.get(session.projectId);
      if (existing !== undefined) {
        // The rollout keeps the thread's dynamic tools, so resume needs no tool list.
        const resumed = yield* session.client.raw
          .request("thread/resume", { threadId: existing, ...threadSettings })
          .pipe(Effect.flatMap(decodeThreadResponse), Effect.option);
        if (Option.isSome(resumed)) return resumed.value.thread.id;
        yield* Effect.logWarning("Voice: resuming the Luna thread failed; starting a new one.");
      }
      const started = yield* session.client.raw
        .request("thread/start", { ...threadSettings, dynamicTools: [DELEGATE_TOOL_SPEC] })
        .pipe(Effect.flatMap(decodeThreadResponse));
      lunaThreads.set(session.projectId, started.thread.id);
      return started.thread.id;
    });

  const registerHandlers = (
    session: LiveSession,
    sdpAnswer: Deferred.Deferred<string, VoiceSessionError>,
  ) =>
    Effect.gen(function* () {
      const { client } = session;
      const isLuna = (threadId: string) => threadId === session.lunaThreadId;
      const touchLuna = (payload: { readonly threadId: string }) =>
        isLuna(payload.threadId) ? touch(session) : Effect.void;

      yield* client.handleServerNotification("thread/realtime/sdp", (payload) =>
        isLuna(payload.threadId) ? Deferred.succeed(sdpAnswer, payload.sdp) : Effect.void,
      );
      yield* client.handleServerNotification("thread/realtime/error", (payload) =>
        isLuna(payload.threadId)
          ? Effect.logWarning("Voice: realtime error.", { message: payload.message }).pipe(
              Effect.andThen(
                Deferred.fail(sdpAnswer, new VoiceSessionError({ message: payload.message })),
              ),
              Effect.andThen(closeSessionDetached(session)),
            )
          : Effect.void,
      );
      yield* client.handleServerNotification("thread/realtime/closed", (payload) =>
        isLuna(payload.threadId)
          ? Deferred.fail(
              sdpAnswer,
              new VoiceSessionError({ message: "The realtime session closed before it started." }),
            ).pipe(Effect.andThen(closeSessionDetached(session)))
          : Effect.void,
      );
      yield* client.handleServerNotification("thread/realtime/transcript/delta", touchLuna);
      yield* client.handleServerNotification("thread/realtime/itemAdded", touchLuna);
      yield* client.handleServerNotification("thread/realtime/item/started", touchLuna);
      yield* client.handleServerNotification("thread/realtime/item/transcript/delta", touchLuna);
      yield* client.handleServerNotification("thread/realtime/item/completed", touchLuna);
      yield* client.handleServerNotification("turn/started", (payload) =>
        isLuna(payload.threadId)
          ? Effect.sync(() => {
              session.activeLunaTurnId = payload.turn.id;
            }).pipe(Effect.andThen(touch(session)))
          : Effect.void,
      );
      yield* client.handleServerNotification("turn/completed", (payload) =>
        isLuna(payload.threadId)
          ? Effect.sync(() => {
              if (session.activeLunaTurnId === payload.turn.id)
                session.activeLunaTurnId = undefined;
            }).pipe(Effect.andThen(touch(session)))
          : Effect.void,
      );
      yield* client.handleServerRequest("item/tool/call", (params) =>
        handleToolCall(session, params),
      );
    });

  const openSession = (input: VoiceStartInput) =>
    Effect.gen(function* () {
      const project = yield* projects.getById(input.projectId).pipe(
        Effect.mapError(voiceError("Could not load the project.")),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new VoiceSessionError({ message: "Project not found." })),
            onSome: Effect.succeed,
          }),
        ),
      );
      const codex = yield* resolveCodexClientInput.pipe(
        Effect.mapError(voiceError("Could not read the Codex provider settings.")),
      );
      const voiceSessionId = VoiceSessionId.make(yield* randomUuidV4);
      const scope = yield* Scope.fork(serviceScope);
      const opened = yield* clientFactory
        .open({
          instanceId: codex.instanceId,
          threadId: ThreadId.make(`voice-${voiceSessionId}`),
          providerSessionId: ProviderSessionId.make(`voice-${voiceSessionId}`),
          runtimePolicy: {
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            cwd: project.workspaceRoot,
          },
          settings: codex.settings,
          environment: codex.environment,
        })
        .pipe(Scope.provide(scope), Effect.exit);
      if (Exit.isFailure(opened)) {
        yield* Scope.close(scope, Exit.void);
        return yield* new VoiceSessionError({
          message: "Could not start the Codex app-server.",
          cause: opened.cause,
        });
      }
      const session: LiveSession = {
        id: voiceSessionId,
        projectId: input.projectId,
        scope,
        client: opened.value,
        delegateLock: yield* Semaphore.make(1),
        lunaThreadId: undefined,
        workThread:
          input.threadId === undefined
            ? undefined
            : { threadId: input.threadId, title: "the current thread" },
        activeLunaTurnId: undefined,
        lastActivityAt: yield* Clock.currentTimeMillis,
        closed: false,
      };
      current = session;

      const established = Effect.gen(function* () {
        const sdpAnswer = yield* Deferred.make<string, VoiceSessionError>();
        yield* registerHandlers(session, sdpAnswer);
        yield* session.client
          .request("initialize", {
            clientInfo: buildCodexInitializeParams().clientInfo,
            capabilities: {
              ...CodexAdapterV2.CODEX_CLIENT_CAPABILITIES,
              // Audio flows over WebRTC straight to the client; no per-chunk work here.
              optOutNotificationMethods: [
                ...CodexAdapterV2.CODEX_CLIENT_CAPABILITIES.optOutNotificationMethods,
                "thread/realtime/outputAudio/delta",
              ],
            },
          })
          .pipe(Effect.mapError(voiceError("Codex app-server initialization failed.")));
        yield* session.client
          .notify("initialized", undefined)
          .pipe(Effect.mapError(voiceError("Codex app-server initialization failed.")));
        session.lunaThreadId = yield* ensureLunaThread(session, project).pipe(
          Effect.mapError(voiceError("Could not open the Luna thread.")),
        );
        if (input.threadId !== undefined) {
          const shell = yield* threadManagement
            .getProjectThreadRecords({ projectId: input.projectId, threadId: input.threadId }, [])
            .pipe(Effect.option);
          if (Option.isSome(shell)) {
            session.workThread = { threadId: input.threadId, title: shell.value.thread.title };
          }
        }
        yield* session.client.raw
          .request("thread/realtime/start", {
            threadId: session.lunaThreadId,
            version: "v3",
            outputModality: "audio",
            transport: { type: "webrtc", sdp: input.sdp },
            includeStartupContext: true,
            prompt: buildVoicePrompt(osUserFirstName()),
            voiceSessionId,
          })
          .pipe(Effect.mapError(voiceError("Codex refused to start the realtime session.")));
        return yield* Deferred.await(sdpAnswer).pipe(
          Effect.timeoutOrElse({
            duration: SDP_ANSWER_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new VoiceSessionError({ message: "Timed out waiting for the WebRTC answer." }),
              ),
          }),
        );
      });

      const sdp = yield* established.pipe(Effect.onError(() => closeSession(session)));

      yield* waitForIdle({
        idleTimeout: VOICE_IDLE_TIMEOUT,
        lastActivityAt: Effect.sync(() => session.lastActivityAt),
        // Luna promised to report Opus results, so hanging up mid-run would strand them.
        busy: Effect.sync(
          () =>
            session.activeLunaTurnId !== undefined ||
            [...activeRuns.values()].includes(session.projectId),
        ),
      }).pipe(
        Effect.andThen(Effect.logInfo("Voice: closing an idle session.")),
        Effect.andThen(closeSessionDetached(session)),
        Effect.forkIn(scope),
      );
      // A turn started before realtime is live would not be spoken.
      yield* flushPendingResults(session).pipe(Effect.forkIn(scope));

      return { voiceSessionId, sdp } satisfies VoiceStartResult;
    });

  return VoiceSessionService.of({
    start: (input) =>
      lifecycle.withPermit(
        Effect.gen(function* () {
          if (current !== undefined) yield* closeSession(current);
          return yield* openSession(input);
        }),
      ),
    stop: (input) =>
      lifecycle.withPermit(
        Effect.suspend(() =>
          current !== undefined && current.id === input.voiceSessionId
            ? closeSession(current)
            : Effect.void,
        ),
      ),
  });
});

type CodexToolCall = {
  readonly tool: string;
  readonly callId: string;
  readonly arguments: unknown;
};

function toolResponse(success: boolean, text: string) {
  return { success, contentItems: [{ type: "inputText" as const, text }] };
}

export const layer = Layer.effect(VoiceSessionService, make);
