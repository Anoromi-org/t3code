import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./environments/primary/target", () => ({
  resolvePrimaryEnvironmentHttpUrl: (path: string) => `http://127.0.0.1:1234${path}`,
}));

const { subscribeHyprnavEventStream } = await import("./hyprnavEventStream");

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  readonly listeners = new Map<string, Listener[]>();
  readonly close = vi.fn(() => {
    this.readyState = FakeEventSource.CLOSED;
  });
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data = "") {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscribeHyprnavEventStream", () => {
  it("shares one stream between consumers and closes it with the last", () => {
    const releaseAgents = subscribeHyprnavEventStream({});
    const releaseFollower = subscribeHyprnavEventStream({});
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.url).toBe("http://127.0.0.1:1234/api/hyprnav/events");

    releaseAgents();
    releaseAgents();
    expect(FakeEventSource.instances[0]!.close).not.toHaveBeenCalled();
    releaseFollower();
    expect(FakeEventSource.instances[0]!.close).toHaveBeenCalledOnce();
  });

  it("forwards agents, status and locked events and replays the latest to late joiners", () => {
    const first = vi.fn();
    const releaseFirst = subscribeHyprnavEventStream({ onEvent: first });
    const source = FakeEventSource.instances[0]!;
    source.emit("agents", '{"agents":[]}');
    source.emit("locked", '{"seq":1}');
    source.emit("locked", '{"seq":2}');
    source.emit("status", '{"connected":true}');
    expect(first.mock.calls).toEqual([
      ["agents", '{"agents":[]}'],
      ["locked", '{"seq":1}'],
      ["locked", '{"seq":2}'],
      ["status", '{"connected":true}'],
    ]);

    const late = vi.fn();
    const releaseLate = subscribeHyprnavEventStream({ onEvent: late });
    expect(late.mock.calls).toEqual([
      ["agents", '{"agents":[]}'],
      ["locked", '{"seq":2}'],
      ["status", '{"connected":true}'],
    ]);
    releaseFirst();
    releaseLate();
  });

  it("does not replay a lock from a daemon that disconnected", () => {
    const releaseFirst = subscribeHyprnavEventStream({});
    const source = FakeEventSource.instances[0]!;
    source.emit("locked", '{"seq":40}');
    source.emit("status", '{"connected":false}');

    const late = vi.fn();
    const releaseLate = subscribeHyprnavEventStream({ onEvent: late });
    expect(late.mock.calls).toEqual([["status", '{"connected":false}']]);

    // The restarted daemon's lock is replayed again.
    source.emit("status", '{"connected":true}');
    source.emit("locked", '{"seq":1}');
    const later = vi.fn();
    const releaseLater = subscribeHyprnavEventStream({ onEvent: later });
    expect(later.mock.calls).toEqual([
      ["status", '{"connected":true}'],
      ["locked", '{"seq":1}'],
    ]);
    releaseFirst();
    releaseLate();
    releaseLater();
  });

  it("tolerates transient errors but gives up after repeated failures", () => {
    const onUnavailable = vi.fn();
    const release = subscribeHyprnavEventStream({ onUnavailable });
    const source = FakeEventSource.instances[0]!;
    source.emit("error");
    source.emit("error");
    expect(onUnavailable).not.toHaveBeenCalled();
    source.emit("open");
    source.emit("error");
    source.emit("error");
    expect(onUnavailable).not.toHaveBeenCalled();
    source.emit("error");
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(source.close).toHaveBeenCalled();

    // A consumer joining a dead stream learns immediately instead of reopening it.
    const lateUnavailable = vi.fn();
    const releaseLate = subscribeHyprnavEventStream({ onUnavailable: lateUnavailable });
    expect(lateUnavailable).toHaveBeenCalledOnce();
    expect(FakeEventSource.instances).toHaveLength(1);
    release();
    releaseLate();
  });

  it("gives up at once when the browser closed the stream for good", () => {
    // A 404 from an older server or a non-loopback host is never retried.
    const onUnavailable = vi.fn();
    const release = subscribeHyprnavEventStream({ onUnavailable });
    const source = FakeEventSource.instances[0]!;
    source.readyState = FakeEventSource.CLOSED;
    source.emit("error");
    expect(onUnavailable).toHaveBeenCalledOnce();
    release();
  });

  it("reports the stream unavailable without EventSource", () => {
    vi.stubGlobal("EventSource", undefined);
    const onUnavailable = vi.fn();
    const release = subscribeHyprnavEventStream({ onUnavailable });
    expect(onUnavailable).toHaveBeenCalledOnce();
    release();
  });

  it("reopens a fresh stream after the last consumer left", () => {
    const releaseOld = subscribeHyprnavEventStream({});
    FakeEventSource.instances[0]!.emit("locked", '{"seq":9}');
    releaseOld();

    const release = subscribeHyprnavEventStream({});
    expect(FakeEventSource.instances).toHaveLength(2);
    // A second consumer of the new stream gets nothing stale from the closed one.
    const onEvent = vi.fn();
    const releaseSecond = subscribeHyprnavEventStream({ onEvent });
    expect(onEvent).not.toHaveBeenCalled();
    release();
    releaseSecond();
  });
});
