import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

/**
 * True when a run-context mutation applied. Interruptions report false so the
 * caller leaves the context untouched; real failures throw for the caller's toast.
 */
export function requireSuccessfulRunContextMutation(
  result: AtomCommandResult<unknown, unknown>,
): boolean {
  if (result._tag !== "Failure") return true;
  if (isAtomCommandInterrupted(result)) return false;
  throw squashAtomCommandFailure(result);
}
