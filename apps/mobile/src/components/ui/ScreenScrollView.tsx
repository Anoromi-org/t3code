import type { ComponentPropsWithoutRef } from "react";
import { Platform } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { withUniwind } from "uniwind";
import { NativeScrollView as ScrollView } from "../../native/NativeScrollViewMarker";

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
}: ComponentPropsWithoutRef<typeof ScrollView> & { readonly keyboardAware?: boolean }) {
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
  if (keyboardAware && Platform.OS === "android") {
    return (
      <ThemedKeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        {...props}
        contentContainerStyle={contentContainerStyle}
      />
    );
  }
  return (
    <ScrollView
      {...(keyboardAware
        ? { keyboardShouldPersistTaps: "handled" as const, automaticallyAdjustKeyboardInsets: true }
        : {})}
      {...props}
      contentContainerStyle={contentContainerStyle}
    />
  );
}
