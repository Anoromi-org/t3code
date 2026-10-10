import type { ComponentProps } from "react";
import { Platform, ScrollView } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { withUniwind } from "uniwind";

const ThemedKeyboardAwareScrollView = withUniwind(KeyboardAwareScrollView);

/** Gap kept between a focused field and the top of the keyboard on Android. */
const KEYBOARD_BOTTOM_OFFSET = 24;

/**
 * Keeps forms and settings readable inside a wide pane while its surface fills the screen.
 * Set `keyboardAware` on screens with text fields so the focused field scrolls above the keyboard.
 */
export function ScreenScrollView({
  keyboardAware = false,
  ...props
}: ComponentProps<typeof ScrollView> & { readonly keyboardAware?: boolean }) {
  const contentContainerStyle = [
    props.contentContainerStyle,
    Platform.OS === "android" && {
      width: "100%" as const,
      maxWidth: 720,
      alignSelf: "center" as const,
    },
  ];
  // Most of these screens are iOS form sheets, where keyboard-controller misplaces the
  // keyboard. UIKit's own keyboard insets reveal the focused field there.
  if (keyboardAware && Platform.OS === "ios") {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        {...props}
        contentContainerStyle={contentContainerStyle}
      />
    );
  }
  if (keyboardAware) {
    return (
      <ThemedKeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        {...props}
        contentContainerStyle={contentContainerStyle}
      />
    );
  }
  return <ScrollView {...props} contentContainerStyle={contentContainerStyle} />;
}
