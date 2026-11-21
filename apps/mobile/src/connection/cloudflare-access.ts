import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Socket from "effect/socket/Socket";

// Cloudflare Access rejects requests without an Access identity, and native traffic cannot
// complete its browser login, so every request to a saved origin carries the service token.
// Loaders that bypass `fetch` add `cloudflareAccessHeaders` themselves. Image and video views
// rely on the CF_Authorization cookie Access returns, which iOS shares and Android does not.
const STORAGE_KEY = "t3code.cloudflare-access.v1";

const CloudflareAccessCredential = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.String,
});
export type CloudflareAccessCredential = typeof CloudflareAccessCredential.Type;

const CloudflareAccessStore = Schema.fromJsonString(
  Schema.Record(Schema.String, CloudflareAccessCredential),
);
const decodeStore = Schema.decodeUnknownSync(CloudflareAccessStore);
const encodeStore = Schema.encodeSync(CloudflareAccessStore);

const credentials = new Map<string, CloudflareAccessCredential>();
let loading: Promise<boolean> | null = null;

// Every loader imports this module, so secure storage (and the Expo runtime it pulls in)
// loads only when a request first needs it.
const secureStore = () => import("expo-secure-store");

// The keychain can be locked when the app starts in the background, so a failed read
// is retried on the next request instead of leaving the process without credentials.
function load(): Promise<boolean> {
  loading ??= secureStore()
    .then((store) => store.getItemAsync(STORAGE_KEY))
    .then(
      (raw) => {
        if (!raw) return true;
        for (const [origin, credential] of Object.entries(decodeStore(raw))) {
          credentials.set(origin, credential);
        }
        return true;
      },
      (cause: unknown) => {
        loading = null;
        console.warn("Could not load Cloudflare Access credentials.", cause);
        return false;
      },
    );
  return loading;
}

/** Origin of an http(s) or ws(s) URL, normalized to its http(s) form. */
export function cloudflareAccessOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export async function readCloudflareAccessCredential(
  url: string,
): Promise<CloudflareAccessCredential | null> {
  await load();
  const origin = cloudflareAccessOrigin(url);
  return origin ? (credentials.get(origin) ?? null) : null;
}

/** Saves or, with `null` or blank fields, removes the credential for the URL's origin. */
export async function writeCloudflareAccessCredential(
  url: string,
  credential: CloudflareAccessCredential | null,
): Promise<void> {
  // Writing without the stored map would drop every other origin's credential.
  if (!(await load())) return;
  const origin = cloudflareAccessOrigin(url);
  if (!origin) return;
  const clientId = credential?.clientId.trim() ?? "";
  const clientSecret = credential?.clientSecret.trim() ?? "";
  if (clientId && clientSecret) {
    credentials.set(origin, { clientId, clientSecret });
  } else if (!credentials.delete(origin)) {
    return;
  }
  await (
    await secureStore()
  ).setItemAsync(STORAGE_KEY, encodeStore(Object.fromEntries(credentials)));
}

function headersFor(url: string): Record<string, string> | null {
  const origin = cloudflareAccessOrigin(url);
  const credential = origin ? credentials.get(origin) : undefined;
  return credential
    ? {
        "CF-Access-Client-Id": credential.clientId,
        "CF-Access-Client-Secret": credential.clientSecret,
      }
    : null;
}

/** Access headers for a request outside the wrapped `fetch`, such as `expo/fetch`. */
export async function cloudflareAccessHeaders(url: string): Promise<Record<string, string>> {
  await load();
  return headersFor(url) ?? {};
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Adds Access headers to a request's init when its origin has a saved credential. */
export async function withCloudflareAccess<Init extends { readonly headers?: HeadersInit }>(
  input: string | URL | Request,
  init: Init | undefined,
): Promise<Init | undefined> {
  await load();
  const accessHeaders = headersFor(requestUrl(input));
  if (!accessHeaders) return init;
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  for (const [name, value] of Object.entries(accessHeaders)) headers.set(name, value);
  return { ...init, headers } as Init;
}

/** `fetch` that adds Access headers for origins with a saved credential. */
export const cloudflareAccessFetch: typeof fetch = async (input, init) =>
  fetch(input, await withCloudflareAccess(input, init));

// React Native's constructor takes handshake headers; the DOM typings in scope omit them.
const HeaderWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: string | Array<string> | null,
  options: { readonly headers: Record<string, string> },
) => WebSocket;

/**
 * Wraps the app's WebSocket constructor so sockets to an Access origin carry the service
 * token. iOS's permessage-deflate module cannot send handshake headers, so those sockets
 * use React Native's WebSocket instead. Sockets open only after an HTTP ticket request,
 * which has already awaited the credential load.
 */
export const layerWebSocketConstructor = (
  base: Layer.Layer<Socket.WebSocketConstructor>,
): Layer.Layer<Socket.WebSocketConstructor> =>
  Layer.effect(
    Socket.WebSocketConstructor,
    Effect.map(Effect.service(Socket.WebSocketConstructor), (open) => (url, options) => {
      const headers = headersFor(url);
      if (!headers) return open(url, options);
      if (options !== undefined && typeof options !== "string" && !Array.isArray(options)) {
        throw new TypeError("WebSocket client options are not supported on mobile");
      }
      return new HeaderWebSocket(url, options ?? null, { headers });
    }),
  ).pipe(Layer.provide(base));
