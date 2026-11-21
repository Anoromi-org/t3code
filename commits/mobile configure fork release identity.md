# Mobile configure fork release identity

Use the fork's Anoromi iOS bundle identifiers, Apple team, Expo owner/project, and update endpoint while preserving upstream assets, widgets, Android identities, release variants, OTA toggle, observe endpoint, and the reduced-capability personal-team override.

Do not submit fork builds to upstream's App Store record or claim upstream's associated domains. `eas.json` no longer hardcodes upstream's `ascAppId`; the iOS store build job (which checks out a fresh tree and submits with `eas submit --profile "$PROFILE"`) injects a numeric fork App Store ID, rejecting upstream's known ID, right before submitting. Upstream's `testflight` submit profile extends production, so TestFlight prereleases inherit the injected target. iOS associated domains require an explicit AASA-authorized hostname (`T3CODE_IOS_RELYING_PARTY`); upstream's `applinks:app.t3.codes` claim is dropped on iOS because that AASA lists only upstream's team and bundles. Android keeps upstream's packages and the `app.t3.codes/threads/` intent filter.

The `keychain-access-groups` entitlement uses the effective bundle ID so personal-team builds sign a group that matches their bundle.

`scripts/mobile-native-client.ts` checks and installs/opens the fork iOS bundle ID (`com.anoromi.t3code.dev`) and upstream's Android package; the `test-t3-mobile` skill opens whichever development app ID the device has.

Configuration tests cover all variants (identity, keychain group), store submission identity and workflow ordering within the iOS store job, the testflight build/submit profile, associated-domain gating, the personal-team path, and invalid identifiers. Upstream's identifier test now asserts the fork iOS IDs stay out of `app.t3.codes` while Android IDs stay in its assetlinks.

Known gap: upstream gates the production workflow job on `github.repository == 'pingdotgg/t3code'`; this commit leaves that guard alone.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `e56444c0a1c` (itself a reimplementation of `7ee84c6f3b`, originally `6f6717ec64`). Upstream moved iOS store builds into a separate local-build job, so the injection step moved there; upstream's `app.config.test.ts` mocks `loadRepoEnv`, so the fork cases now stub env vars through that mock and the per-variant loop became `it.each`.
