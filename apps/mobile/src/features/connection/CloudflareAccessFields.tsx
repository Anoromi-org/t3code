import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import {
  readCloudflareAccessCredential,
  writeCloudflareAccessCredential,
  type CloudflareAccessCredential,
} from "../../connection/cloudflare-access";
import { ConnectionFormField } from "./ConnectionFormField";
import { parseHostInput } from "./pairing";

const EMPTY_CREDENTIAL: CloudflareAccessCredential = { clientId: "", clientSecret: "" };

function hostOrigin(host: string): string | null {
  try {
    return parseHostInput(host).origin;
  } catch {
    return null;
  }
}

/** Form state for the Access service token of the environment at `host`. */
export function useCloudflareAccessCredential(host: string) {
  const [credential, setCredential] = useState(EMPTY_CREDENTIAL);
  const [loadedOrigin, setLoadedOrigin] = useState<string | null>(null);
  const origin = hostOrigin(host);

  // Each origin gets its own form state, so a secret never carries over to another host.
  useEffect(() => {
    if (!origin || origin === loadedOrigin) return;
    let cancelled = false;
    void readCloudflareAccessCredential(origin).then((saved) => {
      if (cancelled) return;
      setLoadedOrigin(origin);
      setCredential(saved ?? EMPTY_CREDENTIAL);
    });
    return () => {
      cancelled = true;
    };
  }, [origin, loadedOrigin]);

  const save = useCallback(async () => {
    if (origin && origin === loadedOrigin) {
      await writeCloudflareAccessCredential(origin, credential);
    }
  }, [origin, loadedOrigin, credential]);

  return { credential, setCredential, save };
}

/** Optional Cloudflare Access service-token fields for a self-hosted tunnel. */
export function CloudflareAccessFields(props: {
  readonly credential: CloudflareAccessCredential;
  readonly onChange: (credential: CloudflareAccessCredential) => void;
}) {
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
          Cloudflare Access
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
            label="Client ID"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="xxxxxxxx.access"
            value={props.credential.clientId}
            onChangeText={(clientId) => props.onChange({ ...props.credential, clientId })}
          />
          <ConnectionFormField
            label="Client secret"
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
