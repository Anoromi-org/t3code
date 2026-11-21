// @effect-diagnostics nodeBuiltinImport:off
/**
 * Desktop agents as hyprnav tracks them, plus the dialog-free screencast
 * pre-answer. Thin wrappers over the `hyprnav` CLI's JSON output.
 */
import * as NodeChildProcess from "node:child_process";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class HyprnavCommandError extends Schema.TaggedError<HyprnavCommandError>()(
  "HyprnavCommandError",
  {
    args: Schema.Array(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `hyprnav ${this.args.join(" ")} failed`;
  }
}

export const HyprnavAgentSchema = Schema.Struct({
  agent_id: Schema.String,
  label: Schema.String,
  client: Schema.String,
  pid: Schema.Int,
  environment_id: Schema.String,
  slot_index: Schema.Int,
  workspace_id: Schema.Int,
  state: Schema.String,
  last_beat_ms: Schema.Finite,
  action_count: Schema.Int,
  last_action: Schema.NullOr(Schema.String),
  current_target: Schema.NullOr(Schema.String),
  attached_windows: Schema.Array(Schema.String),
  created_at_ms: Schema.Finite,
  // Optional so a daemon that predates thread attribution still decodes.
  thread_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  thread_environment_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

type HyprnavAgent = typeof HyprnavAgentSchema.Type;

const decodeAgent = Schema.decodeUnknownOption(HyprnavAgentSchema);

export function runHyprnavJson(
  args: ReadonlyArray<string>,
): Effect.Effect<unknown, HyprnavCommandError> {
  return Effect.tryPromise({
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
    catch: (cause) => new HyprnavCommandError({ args: [...args], cause }),
  });
}

/** Registered agents; entries this build cannot read are skipped, not fatal. */
export const listHyprnavAgentsEffect = Effect.fn("desktop.hyprnav.listAgents")(function* () {
  const value = yield* runHyprnavJson(["agents"]).pipe(Effect.orElseSucceed(() => []));
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReadonlyArray<HyprnavAgent> => {
    const decoded = decodeAgent(entry);
    return Option.isSome(decoded) ? [decoded.value] : [];
  });
});
