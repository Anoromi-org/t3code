import * as Dialog from "../../components/ui/Dialog";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import {
  removeTrustedLinkSource,
  type TrustedLinkSource,
  useTrustedLinkSources,
} from "../prompt-links/trusted-link-sources";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

const addedAtFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function SettingsTrustedLinkSourcesRouteScreen() {
  const sources = useTrustedLinkSources();

  const confirmRemove = (source: TrustedLinkSource) => {
    Dialog.confirm({
      title: `Remove ${source.label}?`,
      message: `Prompt links from ${source.label} will show a notice again before they fill the composer.`,
      confirmText: "Remove",
      destructive: true,
      onConfirm: () => {
        void removeTrustedLinkSource(source.keyHash).catch(() =>
          Dialog.alert("Could not remove", "Try again."),
        );
      },
    });
  };

  return (
    <SettingsScreen title="Trusted link sources">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4 pb-[18px]"
      >
        <SettingsSection title="Apps">
          {sources === null ? (
            <View className="items-center px-6 py-8">
              <AppActivityIndicator />
            </View>
          ) : sources.length === 0 ? (
            <Text className="px-4 py-4 text-sm text-foreground-muted">No trusted apps yet.</Text>
          ) : (
            sources.map((source, index) => (
              <View
                key={source.keyHash}
                className={
                  index === 0
                    ? "flex-row items-center gap-3 p-4"
                    : "border-t border-border flex-row items-center gap-3 p-4"
                }
              >
                <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
                  {source.label}
                  <Text className="text-foreground-muted">
                    {` · ${addedAtFormatter.format(new Date(source.addedAt))}`}
                  </Text>
                </Text>
                <Pressable
                  accessibilityLabel={`Remove ${source.label}`}
                  accessibilityRole="button"
                  onPress={() => confirmRemove(source)}
                  className="rounded-full px-3 py-2"
                >
                  <Text className="font-t3-medium text-danger-foreground">Remove</Text>
                </Pressable>
              </View>
            ))
          )}
        </SettingsSection>
        <Text className="px-2 text-sm leading-normal text-foreground-muted">
          Prompt links from these apps fill the composer without the "Prompt from a link" notice.
          Links with hidden characters still show their warning.
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}
