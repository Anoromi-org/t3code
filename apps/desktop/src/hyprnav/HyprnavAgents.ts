// @effect-diagnostics nodeBuiltinImport:off
/**
 * Desktop agents as hyprnav tracks them, plus the dialog-free screencast
 * pre-answer. Thin wrappers over the `hyprnav` CLI's JSON output.
 */
import * as NodeChildProcess from "node:child_process";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class HyprnavCommandError extends Schema.TaggedErrorClass<HyprnavCommandError>()(
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
  pid: Schema.Number,
  environment_id: Schema.String,
  slot_index: Schema.Number,
  workspace_id: Schema.Number,
  state: Schema.String,
  last_beat_ms: Schema.Number,
  action_count: Schema.Number,
  last_action: Schema.NullOr(Schema.String),
  current_target: Schema.NullOr(Schema.String),
  attached_windows: Schema.Array(Schema.String),
  created_at_ms: Schema.Number,
});

export type HyprnavAgent = typeof HyprnavAgentSchema.Type;

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

export const listHyprnavAgentsEffect = Effect.fn("desktop.hyprnav.listAgents")(function* () {
  const value = yield* runHyprnavJson(["agents"]).pipe(Effect.orElseSucceed(() => []));
  return Array.isArray(value) ? (value as ReadonlyArray<HyprnavAgent>) : [];
});
