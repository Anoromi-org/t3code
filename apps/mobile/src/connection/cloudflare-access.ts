import * as Schema from "effect/Schema";
import * as SecureStore from "expo-secure-store";

/**
 * Cloudflare Access service-token credentials keyed by environment origin.
 *
 * A self-hosted tunnel can sit behind Cloudflare Access, which rejects every request
 * that lacks an Access identity. Native HTTP and WebSocket traffic cannot complete the
 * browser login, so the app sends the service-token headers on every request to that
 * origin. Native loaders that bypass `fetch` must add `cloudflareAccessHeaders`
 * themselves. Image and video views rely on the `CF_Authorization` cookie Access
 * returns, which iOS shares with them; Android image loaders do not.
 */
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

const loaded: Promise<void> = SecureStore.getItemAsync(STORAGE_KEY)
  .then((raw) => {
    if (!raw) return;
    for (const [origin, credential] of Object.entries(decodeStore(raw))) {
      credentials.set(origin, credential);
    }
  })
  .catch((cause: unknown) => {
    console.warn("Could not load Cloudflare Access credentials.", cause);
  });

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
  await loaded;
  const origin = cloudflareAccessOrigin(url);
  return origin ? (credentials.get(origin) ?? null) : null;
}

/** Saves or, with `null` or blank fields, removes the credential for the URL's origin. */
export async function writeCloudflareAccessCredential(
  url: string,
  credential: CloudflareAccessCredential | null,
): Promise<void> {
  await loaded;
  const origin = cloudflareAccessOrigin(url);
  if (!origin) return;
  const clientId = credential?.clientId.trim() ?? "";
  const clientSecret = credential?.clientSecret.trim() ?? "";
  if (clientId && clientSecret) {
    credentials.set(origin, { clientId, clientSecret });
  } else if (!credentials.delete(origin)) {
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, encodeStore(Object.fromEntries(credentials)));
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
  await loaded;
  return headersFor(url) ?? {};
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** `fetch` that adds Access headers for origins with a saved credential. */
export const cloudflareAccessFetch: typeof fetch = async (input, init) => {
  await loaded;
  const accessHeaders = headersFor(requestUrl(input));
  if (!accessHeaders) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : {}));
  for (const [name, value] of Object.entries(accessHeaders)) headers.set(name, value);
  return fetch(input, { ...init, headers });
};

// React Native's constructor takes handshake headers; the DOM typings in scope omit them.
const NativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: string | Array<string> | null,
  options: { readonly headers: Record<string, string> },
) => WebSocket;

/**
 * React Native WebSocket that adds Access headers to the handshake. Sockets open only
 * after an HTTP ticket request, which has already awaited the credential load.
 */
export function openCloudflareAccessWebSocket(
  url: string,
  protocols?: string | Array<string>,
): WebSocket {
  const headers = headersFor(url);
  return headers
    ? new NativeWebSocket(url, protocols ?? null, { headers })
    : new WebSocket(url, protocols);
}
