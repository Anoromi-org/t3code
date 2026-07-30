import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { DraftId } from "./composerDraftStore";
import {
  dedupeRecentThreadTargets,
  promoteRecentThreadTarget,
  recentThreadTargetKey,
  type RecentThreadTarget,
  useRecentThreadStore,
} from "./recentThreadStore";

const ENVIRONMENT_A = EnvironmentId.make("environment-a");
const ENVIRONMENT_B = EnvironmentId.make("environment-b");

function server(id: string, environmentId = ENVIRONMENT_A): RecentThreadTarget {
  return {
    kind: "server",
    threadRef: scopeThreadRef(environmentId, ThreadId.make(id)),
  };
}

function draft(id: string): RecentThreadTarget {
  return { kind: "draft", draftId: DraftId.make(id) };
}

describe("recent thread MRU store", () => {
  beforeEach(() => useRecentThreadStore.getState().reset());

  it("records unique normal visits in MRU order", () => {
    const a = server("a");
    const b = server("b");
    const c = draft("c");
    const store = useRecentThreadStore.getState();

    store.recordVisit(a);
    store.recordVisit(b);
    store.recordVisit(c);
    store.recordVisit(a);

    expect(useRecentThreadStore.getState().history.map(recentThreadTargetKey)).toEqual([
      recentThreadTargetKey(a),
      recentThreadTargetKey(c),
      recentThreadTargetKey(b),
    ]);
  });

  it("freezes one forward and backward traversal gesture", () => {
    const a = server("a");
    const b = server("b");
    const c = server("c");
    const store = useRecentThreadStore.getState();
    store.recordVisit(a);
    store.recordVisit(b);
    store.recordVisit(c);

    store.advance("forward");
    expect(useRecentThreadStore.getState().cycle).toMatchObject({ highlightedIndex: 1 });
    expect(useRecentThreadStore.getState().cycle?.targets[1]).toEqual(b);

    store.recordVisit(draft("ignored-during-cycle"));
    store.advance("forward");
    expect(useRecentThreadStore.getState().cycle?.targets[2]).toEqual(a);
    store.advance("forward");
    expect(useRecentThreadStore.getState().cycle?.targets[0]).toEqual(c);
    store.advance("backward");
    expect(useRecentThreadStore.getState().cycle?.targets[2]).toEqual(a);
  });

  it("commits the selected target once and cancel preserves history", () => {
    const a = server("a");
    const b = server("b");
    const c = server("c");
    const store = useRecentThreadStore.getState();
    store.recordVisit(a);
    store.recordVisit(b);
    store.recordVisit(c);

    store.advance("forward");
    expect(store.commit()).toEqual(b);
    expect(useRecentThreadStore.getState().history).toEqual([b, c, a]);
    expect(store.commit()).toBeNull();

    store.advance("forward");
    store.advance("forward");
    store.cancel();
    expect(useRecentThreadStore.getState().history).toEqual([b, c, a]);
    expect(useRecentThreadStore.getState().cycle).toBeNull();
  });

  it("does not open with fewer than two targets and closes after pruning", () => {
    const a = server("a");
    const b = server("b");
    const store = useRecentThreadStore.getState();
    store.recordVisit(a);
    store.advance("forward");
    expect(useRecentThreadStore.getState().cycle).toBeNull();

    store.recordVisit(b);
    store.advance("forward");
    expect(useRecentThreadStore.getState().cycle).not.toBeNull();
    store.reconcile([b], [b]);
    expect(useRecentThreadStore.getState()).toMatchObject({ history: [b], cycle: null });
  });

  it("preserves scoped environment identity and deduplicates canonical targets", () => {
    const local = server("shared", ENVIRONMENT_A);
    const remote = server("shared", ENVIRONMENT_B);
    expect(recentThreadTargetKey(local)).not.toBe(recentThreadTargetKey(remote));
    expect(dedupeRecentThreadTargets([local, remote, local])).toEqual([local, remote]);
    expect(promoteRecentThreadTarget([local, remote], remote)).toEqual([remote, local]);
  });
});
