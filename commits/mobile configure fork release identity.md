# Mobile configure fork release identity

Reimplements fork commit `7ee84c6f3b` (originally `6f6717ec64`) on the pinned upstream mobile configuration. Use the fork's Anoromi iOS bundle identifiers, Apple team, Expo owner/project, and update endpoint while preserving upstream assets, widgets, Android identities, release variants, OTA toggle, and the reduced-capability personal-team override.

Do not submit fork builds to upstream's App Store record or claim upstream's unauthorized Clerk associated domain. CI injects a numeric fork App Store ID (rejecting upstream's known ID) before iOS builds; upstream's `v2-preview` submit profile extends production, so manual preview builds inherit the injected target. Associated domains require an explicit AASA-authorized hostname (`T3CODE_IOS_RELYING_PARTY`).

Upstream added a `keychain-access-groups` entitlement derived from the variant bundle ID; it now uses the effective bundle ID so personal-team builds sign a group that matches their bundle.

`scripts/mobile-native-client.ts` checks the fork iOS bundle ID (`com.anoromi.t3code.dev`) and upstream's Android package; the `test-t3-mobile` skill opens whichever development app ID the device has.

Configuration tests cover all variants (identity, keychain group), store submission identity and workflow ordering, the v2-preview build/submit profile with OTA disabled, associated-domain gating, the personal-team path, and invalid identifiers.
