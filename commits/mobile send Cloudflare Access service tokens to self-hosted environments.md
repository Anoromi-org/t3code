# Mobile: send Cloudflare Access service tokens to self-hosted environments

## Goal

A self-hosted environment behind a Cloudflare Tunnel can sit behind Cloudflare Access, so unauthenticated traffic never reaches the T3 server. The native app cannot complete Access's browser login, so each environment can carry an Access service token (client ID and secret) that the app sends as `CF-Access-Client-Id` / `CF-Access-Client-Secret`.

## Behavior

- Add Environment and the environment's connection row have a collapsed "Cloudflare Access" section. Values are stored in secure storage keyed by origin (`apps/mobile/src/connection/cloudflare-access.ts`), saved before pairing because pairing requests already need them.
- Headers go on the runtime `fetch` (all Effect HTTP clients), the WebSocket handshake, `expo/fetch` loads (text preview, markdown SVG, ZIP archive download, environment voice transcription), and native attachment downloads.
- Upstream's iOS WebSocket is a native URLSession module (`native/nativeWebSocket`) that offers permessage-deflate but takes no handshake headers. `layerWebSocketConstructor` wraps whichever constructor the platform provides and only switches to React Native's WebSocket, which accepts headers, for origins with a saved token. Other sockets keep the native module.
- Secure storage is imported lazily on the first request, so modules that import a loader never pull in the Expo runtime; a failed keychain read (device locked at background launch) retries on the next request and blocks writes so the other origins are not erased.
- The saved credential is read through an atom family keyed by origin; form edits are scoped to the origin they were typed for, so editing the URL never carries one host's secret to another.
- Image and video views cannot add headers. They reuse the `CF_Authorization` cookie Access returns after the first token request; Android image loaders do not share it.
- The secret field opts out of iOS password saving (`textContentType="oneTimeCode"`).

## Keyboard

`components/ui/ScreenScrollView` gains `keyboardAware`, used by the connection screens. On iOS it uses `automaticallyAdjustKeyboardInsets`: these screens are native form sheets, where react-native-keyboard-controller's `KeyboardAwareScrollView` misplaces the keyboard. Android uses `KeyboardAwareScrollView`. Without `keyboardAware` it keeps upstream's surface and bottom-inset behavior.

## Not covered

Web and desktop clients rely on Access's browser cookie; they get no token fields. Device and preview streams open their sockets inside a WebView or through client-runtime's own `new WebSocket`, and the preview-stream upload uses plain `fetch` with cookie credentials; behind Access they depend on the same cookie.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `8d4b5d3cbdf`. Upstream replaced the global WebSocket constructor with `NativeWebSocket.layer`, so the Access wrapper now decorates that layer instead of replacing it; upstream added ZIP and voice `expo/fetch` loaders, which now carry the headers too; the form's credential load moved from an effect to an atom family; `ConnectionsNewRouteScreen.test.tsx` and `ZipArchiveView.test.tsx` mock the Access module because they stub atoms and run fake timers.
