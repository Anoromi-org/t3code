// @effect-diagnostics nodeBuiltinImport:off
import { DesktopCorkdiffFocusError, type ThreadId } from "@t3tools/contracts";
import { hyprctlCommandError, hyprlandFocusWindowDispatcher } from "@t3tools/shared/hyprland";
import * as NodeChildProcess from "node:child_process";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const MAX_HYPRCTL_OUTPUT_BYTES = 64 * 1024;
const HYPRCTL_TIMEOUT_MS = 2_000;

interface HyprClient {
  readonly address?: unknown;
  readonly class?: unknown;
  readonly initialClass?: unknown;
}

const HyprClientsJson = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      address: Schema.optionalKey(Schema.Unknown),
      class: Schema.optionalKey(Schema.Unknown),
      initialClass: Schema.optionalKey(Schema.Unknown),
    }),
  ),
);
const decodeHyprClientsJson = Schema.decodeUnknownEffect(HyprClientsJson);

export function findClientAddressForClasses(
  clients: readonly HyprClient[],
  classNames: ReadonlySet<string>,
): string | null {
  const client = clients.find(
    (candidate) =>
      (typeof candidate.class === "string" && classNames.has(candidate.class)) ||
      (typeof candidate.initialClass === "string" && classNames.has(candidate.initialClass)),
  );
  return typeof client?.address === "string" && client.address.trim().length > 0
    ? client.address
    : null;
}

export interface DesktopFocusService {
  readonly focusForCorkdiff: (threadId: ThreadId) => Effect.Effect<void, DesktopCorkdiffFocusError>;
}

type RunHyprctl = (args: readonly string[]) => Effect.Effect<string, DesktopCorkdiffFocusError>;

const runHyprctlLive: RunHyprctl = (args) =>
  Effect.callback<string, DesktopCorkdiffFocusError>((resume) => {
    const child = NodeChildProcess.execFile(
      "hyprctl",
      [...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_HYPRCTL_OUTPUT_BYTES,
        timeout: HYPRCTL_TIMEOUT_MS,
      },
      (cause, stdout, stderr) => {
        const commandError = hyprctlCommandError({
          code: cause ? 1 : 0,
          stdout,
          stderr: stderr.trim() || cause?.message || "",
        });
        if (commandError !== null) {
          resume(
            Effect.fail(
              new DesktopCorkdiffFocusError({
                message: commandError,
              }),
            ),
          );
          return;
        }
        resume(Effect.succeed(stdout));
      },
    );
    return Effect.sync(() => child.kill());
  });

export function make(
  runHyprctl: RunHyprctl,
  resolveClassNames: () => readonly (string | undefined)[] = () => [
    process.env.T3CODE_DESKTOP_WM_CLASS,
    process.env.T3CODE_DESKTOP_WAYLAND_APP_ID,
  ],
): DesktopFocusService {
  const focusForCorkdiff = Effect.fn("desktopFocus.focusForCorkdiff")(function* (
    threadId: ThreadId,
  ) {
    yield* Effect.annotateCurrentSpan({ threadId });
    const classNames = new Set(
      resolveClassNames()
        .map((className) => className?.trim())
        .filter(
          (className): className is string => className !== undefined && className.length > 0,
        ),
    );
    if (classNames.size === 0) {
      return yield* new DesktopCorkdiffFocusError({
        message: "This server was not started by the T3 Code desktop app.",
      });
    }

    const clientsJson = yield* runHyprctl(["-j", "clients"]);
    const clients = yield* decodeHyprClientsJson(clientsJson).pipe(
      Effect.mapError(
        () => new DesktopCorkdiffFocusError({ message: "hyprctl returned invalid client data." }),
      ),
    );
    const address = findClientAddressForClasses(clients, classNames);
    if (address === null) {
      return yield* new DesktopCorkdiffFocusError({
        message: "The T3 Code desktop window was not found in Hyprland.",
      });
    }
    yield* runHyprctl(["dispatch", hyprlandFocusWindowDispatcher(address)]);
  });

  return { focusForCorkdiff };
}

export const live = make(runHyprctlLive);
