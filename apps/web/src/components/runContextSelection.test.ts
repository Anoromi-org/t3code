import { AsyncResult } from "effect/unstable/reactivity";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { requireSuccessfulRunContextMutation } from "./runContextSelection";

describe("requireSuccessfulRunContextMutation", () => {
  it("accepts successful mutations", () => {
    expect(requireSuccessfulRunContextMutation(AsyncResult.success(undefined))).toBe(true);
  });

  it("leaves interrupted mutations unapplied", () => {
    expect(requireSuccessfulRunContextMutation(AsyncResult.failure(Cause.interrupt(1)))).toBe(
      false,
    );
  });

  it("preserves actionable failures", () => {
    expect(() =>
      requireSuccessfulRunContextMutation(AsyncResult.failure(Cause.fail(new Error("failed")))),
    ).toThrow("failed");
  });
});
