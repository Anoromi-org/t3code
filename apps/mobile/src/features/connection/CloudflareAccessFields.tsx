import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { T, useGT } from "gt-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import {
  readCloudflareAccessCredential,
  writeCloudflareAccessCredential,
  type CloudflareAccessCredential,
} from "../../connection/cloudflare-access";
import { ConnectionFormField } from "./ConnectionFormField";
import { parseHostInput } from "./pairing";

const EMPTY_CREDENTIAL: CloudflareAccessCredential = { clientId: "", clientSecret: "" };

const savedCredentialAtom = Atom.family((origin: string) =>
  Atom.make(Effect.promise(() => readCloudflareAccessCredential(origin))).pipe(
    Atom.withLabel("mobile:cloudflare-access-credential"),
  ),
);

function hostOrigin(host: string): string | null {
  try {
    return parseHostInput(host).origin;
  } catch {
    return null;
  }
}

/** Form state for the Access service token of the environment at `host`. */
export function useCloudflareAccessCredential(host: string) {
  const origin = hostOrigin(host);
  const saved = useAtomValue(savedCredentialAtom(origin ?? ""));
  const loaded = origin !== null && AsyncResult.isSuccess(saved);
  // Edits belong to one origin, so a secret never carries over to another host while the
  // address is edited.
  const [draft, setDraft] = useState<{
    readonly origin: string | null;
    readonly credential: CloudflareAccessCredential;
  } | null>(null);
  const credential =
    draft !== null && draft.origin === origin
      ? draft.credential
      : loaded
        ? (saved.value ?? EMPTY_CREDENTIAL)
        : EMPTY_CREDENTIAL;

  const setCredential = (next: CloudflareAccessCredential) =>
    setDraft({ origin, credential: next });
  // Saving before the stored value loads would erase it with the empty form.
  const save = async () => {
    if (loaded) await writeCloudflareAccessCredential(origin, credential);
  };

  return { credential, setCredential, save };
}

/** Optional Cloudflare Access service-token fields for a self-hosted tunnel. */
export function CloudflareAccessFields(props: {
  readonly credential: CloudflareAccessCredential;
  readonly onChange: (credential: CloudflareAccessCredential) => void;
}) {
  const gt = useGT();
  // Saved credentials load after mount, so stay open for them until the user toggles.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? props.credential.clientId.length > 0;

  return (
    <View collapsable={false} className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        className="flex-row items-center justify-between active:opacity-70"
        onPress={() => setToggled(!expanded)}
      >
        <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
          <T>Cloudflare Access</T>
        </Text>
        <SymbolView
          name="chevron.down"
          size={12}
          tintColorClassName="accent-icon-subtle"
          type="monochrome"
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>
      {expanded ? (
        <>
          <ConnectionFormField
            label={gt("Client ID", { $context: "Cloudflare Access service token field" })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="xxxxxxxx.access"
            value={props.credential.clientId}
            onChangeText={(clientId) => props.onChange({ ...props.credential, clientId })}
          />
          <ConnectionFormField
            label={gt("Client secret", { $context: "Cloudflare Access service token field" })}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            // A service secret, not an account password: keep iOS from offering to save it.
            textContentType="oneTimeCode"
            autoComplete="off"
            value={props.credential.clientSecret}
            onChangeText={(clientSecret) => props.onChange({ ...props.credential, clientSecret })}
          />
        </>
      ) : null}
    </View>
  );
}
