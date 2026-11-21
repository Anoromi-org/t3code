import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { appAtomRegistry } from "../../state/atom-registry";

const TrustedLinkSourceSchema = Schema.Struct({
  label: Schema.String,
  keyHash: Schema.String,
  addedAt: Schema.String,
});

export type TrustedLinkSource = typeof TrustedLinkSourceSchema.Type;

const STORAGE_KEY = "t3code.prompt-links.trusted-sources";
const decodeStored = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(TrustedLinkSourceSchema)),
);

let entries: ReadonlyArray<TrustedLinkSource> | null = null;
let loading: Promise<ReadonlyArray<TrustedLinkSource>> | null = null;

function loadTrustedLinkSources(): Promise<ReadonlyArray<TrustedLinkSource>> {
  if (entries !== null) return Promise.resolve(entries);
  loading ??= SecureStore.getItemAsync(STORAGE_KEY)
    .then((raw) => (raw === null ? [] : decodeStored(raw)))
    // Unreadable storage trusts nothing; every link then shows its notice.
    .catch((): ReadonlyArray<TrustedLinkSource> => [])
    .then((loaded) => {
      // A write that finished while this read was in flight is newer.
      entries ??= loaded;
      return entries;
    });
  return loading;
}

const trustedLinkSourcesAtom = Atom.make(Effect.promise(loadTrustedLinkSources)).pipe(
  Atom.withLabel("mobile:trusted-link-sources"),
);

// Publishes only once stored, so a failed write leaves what Settings shows matching the device.
async function save(next: ReadonlyArray<TrustedLinkSource>): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
  entries = next;
  appAtomRegistry.refresh(trustedLinkSourcesAtom);
}

// Only the hash is stored, so the device never holds a key it could leak back out.
export const hashLinkKey = (key: string): Promise<string> =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);

export async function isTrustedLinkKey(key: string): Promise<boolean> {
  const [keyHash, current] = await Promise.all([hashLinkKey(key), loadTrustedLinkSources()]);
  return current.some((entry) => entry.keyHash === keyHash);
}

export async function trustLinkSource(source: {
  readonly label: string;
  readonly key: string;
}): Promise<void> {
  const [keyHash, current] = await Promise.all([hashLinkKey(source.key), loadTrustedLinkSources()]);
  await save([
    ...current.filter((entry) => entry.keyHash !== keyHash),
    { label: source.label, keyHash, addedAt: new Date().toISOString() },
  ]);
}

export async function removeTrustedLinkSource(keyHash: string): Promise<void> {
  const current = await loadTrustedLinkSources();
  await save(current.filter((entry) => entry.keyHash !== keyHash));
}

/** Null until storage has been read. */
export function useTrustedLinkSources(): ReadonlyArray<TrustedLinkSource> | null {
  const result = useAtomValue(trustedLinkSourcesAtom);
  return AsyncResult.isSuccess(result) ? result.value : null;
}

export function resetTrustedLinkSourcesForTest() {
  entries = null;
  loading = null;
}
