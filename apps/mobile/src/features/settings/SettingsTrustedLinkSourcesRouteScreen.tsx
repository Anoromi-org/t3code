import { T, useGT } from "gt-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as Dialog from "../../components/ui/Dialog";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { cn } from "../../lib/cn";
import {
  removeTrustedLinkSource,
  type TrustedLinkSource,
  useTrustedLinkSources,
} from "../prompt-links/trusted-link-sources";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

const addedAtFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function SettingsTrustedLinkSourcesRouteScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const sources = useTrustedLinkSources();

  const confirmRemove = (source: TrustedLinkSource) => {
    Dialog.confirm({
      title: gt("Remove {app}?", { app: source.label }),
      message: gt(
        "Prompt links from {app} will show a notice again before they fill the composer.",
        { app: source.label },
      ),
      confirmText: gt("Remove", { $context: "verb, stops trusting an app's links" }),
      destructive: true,
      onConfirm: () => {
        void removeTrustedLinkSource(source.keyHash).catch(() =>
          Dialog.alert(gt("Could not remove"), gt("Try again.")),
        );
      },
    });
  };

  return (
    <SettingsScreen title={gt("Trusted link sources")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title={gt("Apps")}>
          {sources === null ? (
            <View className="items-center px-6 py-8">
              <AppActivityIndicator />
            </View>
          ) : sources.length === 0 ? (
            <Text className="px-4 py-4 text-sm text-foreground-muted">
              <T>No trusted apps yet.</T>
            </Text>
          ) : (
            sources.map((source, index) => (
              <View
                key={source.keyHash}
                className={cn(
                  "flex-row items-center gap-3 p-4",
                  index > 0 && "border-t border-border",
                )}
              >
                <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
                  {source.label}
                  <Text className="text-foreground-muted">
                    {` · ${addedAtFormatter.format(new Date(source.addedAt))}`}
                  </Text>
                </Text>
                <Pressable
                  accessibilityLabel={gt("Remove {app}", { app: source.label })}
                  accessibilityRole="button"
                  onPress={() => confirmRemove(source)}
                  className="rounded-full px-3 py-2 active:opacity-70"
                >
                  <Text className="font-t3-medium text-danger-foreground">
                    {gt("Remove", { $context: "verb, stops trusting an app's links" })}
                  </Text>
                </Pressable>
              </View>
            ))
          )}
        </SettingsSection>
        <Text className="px-2 text-sm leading-normal text-foreground-muted">
          <T>
            Prompt links from these apps fill the composer without the link notice. Links with
            hidden characters still show their warning.
          </T>
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}
