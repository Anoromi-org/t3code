# Mobile: send Cloudflare Access service tokens to self-hosted environments

## Goal

A self-hosted environment behind a Cloudflare Tunnel can sit behind Cloudflare Access, so unauthenticated traffic never reaches the T3 server. The native app cannot complete Access's browser login, so each environment can carry an Access service token (client ID and secret) that the app sends as `CF-Access-Client-Id` / `CF-Access-Client-Secret`.

## Behavior

- Add Environment and the environment's connection row have a collapsed "Cloudflare Access" section. Values are stored in secure storage keyed by origin (`apps/mobile/src/connection/cloudflare-access.ts`), saved before pairing because pairing requests already need them.
- Headers go on the runtime `fetch` (all Effect HTTP clients), the WebSocket handshake (React Native's constructor accepts headers), the `expo/fetch` text preview, and native attachment downloads.
- Image and video views cannot add headers. They reuse the `CF_Authorization` cookie Access returns after the first token request (verified against a live tunnel); Android image loaders do not share it.
- Form state is per origin, so editing the URL never carries one host's secret to another.
- The secret field opts out of iOS password saving (`textContentType="oneTimeCode"`).

## Keyboard

`ScreenScrollView` gains `keyboardAware`, used by the connection screens. On iOS it uses `automaticallyAdjustKeyboardInsets`: these screens are native form sheets, where react-native-keyboard-controller's `KeyboardAwareScrollView` misplaces the keyboard and leaves the focused field covered. Android keeps `KeyboardAwareScrollView`.

## Not covered

Web and desktop clients rely on Access's browser cookie; they get no token fields.
