import { afterEach, expect, it, vi } from "vite-plus/test";

const secureStore = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStore.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  }),
}));

import {
  cloudflareAccessFetch,
  cloudflareAccessOrigin,
  readCloudflareAccessCredential,
  writeCloudflareAccessCredential,
} from "./cloudflare-access";

const fetchMock = vi.fn((_input: unknown, _init?: RequestInit) =>
  Promise.resolve(new Response(null)),
);
vi.stubGlobal("fetch", fetchMock);

afterEach(async () => {
  fetchMock.mockClear();
  await writeCloudflareAccessCredential("https://t3.example.test", null);
});

it("maps WebSocket URLs to the origin their HTTP requests use", () => {
  expect(cloudflareAccessOrigin("wss://t3.example.test/ws?wsTicket=x")).toBe(
    "https://t3.example.test",
  );
  expect(cloudflareAccessOrigin("ws://10.0.0.2:3773/ws")).toBe("http://10.0.0.2:3773");
  expect(cloudflareAccessOrigin("file:///tmp/x")).toBeNull();
});

it("adds Access headers only for the saved origin and keeps existing headers", async () => {
  await writeCloudflareAccessCredential("https://t3.example.test/some/path", {
    clientId: " id.access ",
    clientSecret: "secret",
  });

  await cloudflareAccessFetch("https://t3.example.test/api/auth/session", {
    headers: { Authorization: "Bearer token" },
  });
  const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
  expect(headers.get("CF-Access-Client-Id")).toBe("id.access");
  expect(headers.get("CF-Access-Client-Secret")).toBe("secret");
  expect(headers.get("Authorization")).toBe("Bearer token");

  await cloudflareAccessFetch("https://other.example.test/", undefined);
  expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined();
});

it("persists credentials and removes them when cleared", async () => {
  await writeCloudflareAccessCredential("https://t3.example.test", {
    clientId: "id.access",
    clientSecret: "secret",
  });
  expect(secureStore.get("t3code.cloudflare-access.v1")).toContain("https://t3.example.test");

  await writeCloudflareAccessCredential("https://t3.example.test", {
    clientId: "",
    clientSecret: "",
  });
  expect(await readCloudflareAccessCredential("https://t3.example.test")).toBeNull();
  expect(secureStore.get("t3code.cloudflare-access.v1")).toBe("{}");
});
