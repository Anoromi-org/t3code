import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { connect, pair, type Client, type Credential } from "./client.ts";
import { createConnection } from "./connection.ts";
import { T3Connect } from "./react.tsx";

vi.mock("./client.ts", () => ({ connect: vi.fn(), pair: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => vi.resetAllMocks());
const credential: Credential = { url: "http://localhost:3773", token: "secret" };
function fakeClient() {
  const closed = Promise.withResolvers<void>();
  const client = {
    rpc: {} as Client["rpc"],
    dispatchCommand: vi.fn(),
    closed: closed.promise,
    close: vi.fn(async () => closed.resolve()),
  } satisfies Client;
  return { client, closed };
}

describe("connection ownership", () => {
  it("retains the exchanged credential when dialing fails, and reconnects without consuming the link again", async () => {
    const saved = vi.fn(async () => {});
    const connection = createConnection({ saveCredential: saved });
    vi.mocked(pair).mockResolvedValue(credential);
    vi.mocked(connect).mockRejectedValueOnce(new Error("offline"));
    await connection.pair("pairing-link");
    expect(connection.getSnapshot().status).toBe("error");
    expect(saved).toHaveBeenCalledWith(credential);
    const { client } = fakeClient();
    vi.mocked(connect).mockResolvedValue(client);
    await connection.reconnect();
    expect(pair).toHaveBeenCalledTimes(1);
    expect(connection.getSnapshot()).toMatchObject({ status: "connected", client });
    await connection.disconnect();
    expect(client.close).toHaveBeenCalledOnce();
    expect(connection.getSnapshot().status).toBe("disconnected");
  });
  it("closes a late connection after cancellation without restoring connected state", async () => {
    const pending = Promise.withResolvers<Client>();
    const dialing = Promise.withResolvers<void>();
    vi.mocked(connect).mockImplementation(() => {
      dialing.resolve();
      return pending.promise;
    });
    const connection = createConnection();
    const operation = connection.connect(credential);
    await dialing.promise;
    await connection.disconnect();
    const { client } = fakeClient();
    pending.resolve(client);
    await operation;
    expect(client.close).toHaveBeenCalledOnce();
    expect(connection.getSnapshot().status).toBe("disconnected");
  });
  it("reports a lost connection and reconnects with a fresh client", async () => {
    const first = fakeClient();
    const second = fakeClient();
    vi.mocked(connect).mockResolvedValueOnce(first.client).mockResolvedValueOnce(second.client);
    const connection = createConnection();
    await connection.connect(credential);
    first.closed.resolve();
    await first.client.closed;
    expect(connection.getSnapshot().status).toBe("error");
    await connection.reconnect();
    expect(connection.getSnapshot()).toMatchObject({ status: "connected", client: second.client });
    await connection.disconnect();
  });
});

it("pairs through the shared component, clears the secret field, and disconnects", async () => {
  const pending = Promise.withResolvers<Client>();
  const dialing = Promise.withResolvers<void>();
  vi.mocked(pair).mockResolvedValue(credential);
  vi.mocked(connect).mockImplementation(() => {
    dialing.resolve();
    return pending.promise;
  });
  const connection = createConnection();
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<T3Connect connection={connection} />);
  });
  try {
    await act(async () => {
      view.root
        .findByType("input")
        .props.onChange({ target: { value: "http://localhost/pair#token=secret" } });
    });
    await act(async () => {
      view.root.findByType("form").props.onSubmit({ preventDefault() {} });
      await dialing.promise;
    });
    expect(view.root.findByType("input").props.value).toBe("");
    expect(view.root.findByProps({ role: "status" }).children).toEqual(["Connecting…"]);
    const { client } = fakeClient();
    await act(async () => {
      pending.resolve(client);
      await pending.promise;
    });
    expect(view.root.findByProps({ role: "status" }).children.join("")).toBe(
      "Connected to localhost:3773",
    );
    await act(async () => {
      view.root.findByType("button").props.onClick();
    });
    expect(client.close).toHaveBeenCalledOnce();
    expect(view.root.findByType("input").props.value).toBe("");
  } finally {
    await act(async () => {
      await connection.disconnect();
      view.unmount();
    });
  }
});
