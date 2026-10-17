/**
 * Fork: when a Codex thread was continued outside T3 Code (for example from the
 * CLI), resuming it in T3 Code shows the turns that happened in between.
 *
 * Upstream resumes with `excludeTurns: true`, so history no longer comes back
 * from `thread/resume`. After a resume this reads the most recent settled turns
 * and turns the user and assistant text of every turn after the last one T3
 * Code recorded into messages. Tool transcripts are not copied. Turns are only
 * reconciled after an anchor T3 Code knows, so history Codex copied into a
 * forked native thread, or that predates T3 Code's thread, is never duplicated.
 */
import type {
  MessageId,
  NodeId,
  OrchestrationV2ConversationMessage,
  OrchestrationV2TurnItem,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexSchema from "effect-codex-app-server/schema";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Turns continued outside T3 Code since its last session; the read stays bounded. */
const RESUMED_HISTORY_TURN_LIMIT = 100;

const CodexHistoryMode = Schema.Struct({
  thread: Schema.Struct({
    historyMode: Schema.optionalKey(Schema.Literals(["legacy", "paginated"])),
  }),
});
const CodexLegacyThreadTurns = Schema.Struct({
  thread: Schema.Struct({ turns: Schema.Array(Schema.Unknown) }),
});
const CodexRawTurnsPage = Schema.Struct({ data: Schema.Array(Schema.Unknown) });
const decodeCodexHistoryMode = Schema.decodeUnknownEffect(CodexHistoryMode);
const decodeCodexLegacyThreadTurns = Schema.decodeUnknownEffect(CodexLegacyThreadTurns);
const decodeCodexRawTurnsPage = Schema.decodeUnknownEffect(CodexRawTurnsPage);
const decodeCodexHistoryTurn = Schema.decodeUnknownOption(CodexSchema.V2ThreadReadResponse__Turn);

export type CodexHistoryTurn = CodexSchema.V2ThreadReadResponse__Turn;

const invalidPayload = (method: string) => (error: Schema.SchemaError) =>
  CodexErrors.CodexAppServerRequestError.invalidPayload(method, "decode-payload", error);

/**
 * The most recent settled turns of a native thread in conversation order
 * (oldest first). Each turn decodes on its own, so one unfamiliar item cannot
 * hide the rest of the history.
 */
export const readCodexSettledHistoryTurns = Effect.fn("CodexAdapterV2.readSettledHistoryTurns")(
  function* (
    raw: Pick<CodexClient.CodexAppServerClient["Service"]["raw"], "request">,
    threadId: string,
  ) {
    const metadata = yield* decodeCodexHistoryMode(
      yield* raw.request("thread/read", { threadId, includeTurns: false }),
    ).pipe(Effect.mapError(invalidPayload("thread/read")));
    let rawTurns: ReadonlyArray<unknown>;
    if (metadata.thread.historyMode === "paginated") {
      const page = yield* decodeCodexRawTurnsPage(
        yield* raw.request("thread/turns/list", {
          threadId,
          cursor: null,
          limit: RESUMED_HISTORY_TURN_LIMIT,
          sortDirection: "desc",
          itemsView: "full",
        }),
      ).pipe(Effect.mapError(invalidPayload("thread/turns/list")));
      rawTurns = page.data.toReversed();
    } else {
      const legacy = yield* decodeCodexLegacyThreadTurns(
        yield* raw.request("thread/read", { threadId, includeTurns: true }),
      ).pipe(Effect.mapError(invalidPayload("thread/read")));
      rawTurns = legacy.thread.turns.slice(-RESUMED_HISTORY_TURN_LIMIT);
    }
    // Keep the provider's order: timestamps are optional whole seconds, so
    // sorting by them could reorder a conversation.
    return rawTurns.flatMap((rawTurn) => {
      const turn = decodeCodexHistoryTurn(rawTurn);
      return Option.isSome(turn) && turn.value.status !== "inProgress" ? [turn.value] : [];
    });
  },
);

/** Turns after the last one T3 Code recorded, or none when no recorded turn anchors the list. */
export function unrecordedCodexTurns(
  turns: ReadonlyArray<CodexHistoryTurn>,
  knownNativeTurnIds: ReadonlySet<string>,
): ReadonlyArray<CodexHistoryTurn> {
  const anchor = turns.findLastIndex((turn) => knownNativeTurnIds.has(turn.id));
  return anchor === -1 ? [] : turns.slice(anchor + 1);
}

export interface ReconciledHistoryTarget {
  readonly threadId: ThreadId;
  readonly providerThreadId: ProviderThreadId;
  /** The run the history follows, so it sorts after it and before the next prompt. */
  readonly runId: RunId | null;
  readonly nodeId: NodeId | null;
}

/**
 * Messages and turn items for reconciled turns. Messages get one-millisecond
 * offsets from their turn's start and never precede the previous turn's, so
 * turns Codex reports in the same second keep their order.
 */
export function codexReconciledHistoryArtifacts(input: {
  readonly turns: ReadonlyArray<CodexHistoryTurn>;
  readonly target: ReconciledHistoryTarget;
  readonly ids: {
    readonly message: (nativeItemId: string) => MessageId;
    readonly turnItem: (nativeItemId: string) => TurnItemId;
  };
  readonly now: DateTime.Utc;
}): ReadonlyArray<{
  readonly message: OrchestrationV2ConversationMessage;
  readonly turnItem: OrchestrationV2TurnItem;
}> {
  const artifacts: Array<{
    readonly message: OrchestrationV2ConversationMessage;
    readonly turnItem: OrchestrationV2TurnItem;
  }> = [];
  let previousMs: number | undefined;
  for (const turn of input.turns) {
    const reportedSeconds = turn.startedAt ?? turn.completedAt ?? null;
    const reportedMs =
      reportedSeconds === null ? DateTime.toEpochMillis(input.now) : reportedSeconds * 1000;
    const baseMs = previousMs === undefined ? reportedMs : Math.max(reportedMs, previousMs + 1);
    turn.items.forEach((item, index) => {
      const text =
        item.type === "userMessage"
          ? item.content
              .flatMap((content) => (content.type === "text" ? [content.text] : []))
              .join("\n")
              .trim()
          : item.type === "agentMessage"
            ? item.text.trim()
            : "";
      if (!text) return;
      const role = item.type === "userMessage" ? "user" : "assistant";
      const nativeItemId = `resume-history:${turn.id}:${item.id}`;
      const at = DateTime.makeUnsafe(baseMs + index);
      const messageId = input.ids.message(nativeItemId);
      const common = {
        id: input.ids.turnItem(nativeItemId),
        threadId: input.target.threadId,
        runId: input.target.runId,
        nodeId: input.target.nodeId,
        providerThreadId: input.target.providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: index + 1,
        status: "completed" as const,
        title: null,
        startedAt: at,
        completedAt: at,
        updatedAt: at,
        messageId,
        text,
      };
      artifacts.push({
        message: {
          createdBy: role === "user" ? "user" : "agent",
          creationSource: "provider",
          id: messageId,
          threadId: input.target.threadId,
          runId: input.target.runId,
          nodeId: input.target.nodeId,
          role,
          text,
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
        turnItem:
          role === "user"
            ? {
                ...common,
                createdBy: "user",
                creationSource: "provider",
                type: "user_message",
                inputIntent: "turn_start",
                attachments: [],
              }
            : { ...common, type: "assistant_message", streaming: false },
      });
    });
    previousMs = baseMs + Math.max(0, turn.items.length - 1);
  }
  return artifacts;
}
