import { createContext, use, type ComponentProps } from "react";
import { Platform } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { withUniwind } from "uniwind";
import { cn } from "../../lib/cn";
import { NativeScrollView as ScrollView } from "../../native/NativeScrollViewMarker";

export const ScreenScrollViewBottomInset = createContext(0);
/**
 * The screen's surface class. UIKit's scroll-edge material under the header takes the scroll
 * view's own color; a clear scroll view gets the system's near-white bar over the screen's surface.
 */
export const ScreenScrollViewSurface = createContext<string | undefined>(undefined);

const ThemedKeyboardAwareScrollView = withUniwind(KeyboardAwareScrollView);

/** Gap kept between a focused field and the top of the keyboard on Android. */
const KEYBOARD_BOTTOM_OFFSET = 24;

/** Set `keyboardAware` on screens with text fields so the focused field scrolls above the keyboard. */
export function ScreenScrollView({
  keyboardAware = false,
  ref,
  ...props
}: ComponentProps<typeof ScrollView> & { readonly keyboardAware?: boolean }) {
  const bottomInset = use(ScreenScrollViewBottomInset);
  const surface = use(ScreenScrollViewSurface);
  const contentContainerStyle = [
    props.contentContainerStyle,
    Platform.OS === "android" && {
      width: "100%" as const,
      maxWidth: 720,
      alignSelf: "center" as const,
    },
  ];
  // iOS form sheets misplace keyboard-controller's keyboard; UIKit's own insets reveal the field there.
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
      ref={ref}
      {...(keyboardAware
        ? { keyboardShouldPersistTaps: "handled" as const, automaticallyAdjustKeyboardInsets: true }
        : {})}
      {...props}
      className={Platform.OS === "ios" && surface ? cn(surface, props.className) : props.className}
      contentInset={
        Platform.OS === "ios" && bottomInset > 0
          ? { ...props.contentInset, bottom: (props.contentInset?.bottom ?? 0) + bottomInset }
          : props.contentInset
      }
      contentContainerStyle={contentContainerStyle}
    />
  );
}
