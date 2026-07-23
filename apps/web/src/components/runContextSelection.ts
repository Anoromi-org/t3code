import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

export function requireSuccessfulRunContextMutation(
  result: AtomCommandResult<unknown, unknown>,
): boolean {
  if (result._tag !== "Failure") return true;
  if (isAtomCommandInterrupted(result)) return false;
  throw squashAtomCommandFailure(result);
}
