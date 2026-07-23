# Client harden thread resynchronization on app activation

Use upstream's authoritative shell-snapshot synchronization as the base while retaining fork-only activation safeguards: foreground resubscription begins from the latest applied sequence, deleted threads remain stable, and repeated snapshots do not recreate subscriptions for deleted threads.

The mobile transition selector remains valid CSS so activation and resynchronization styling is parsed consistently.

## Reimplementation Sources

The upstream implementation supersedes source commit `2ecaf890a`. Relevant follow-ups from `53f613927`, `d8720cdf2`, `679a18437`, and the CSS correction from `7e59c22d2` are represented here; patches already identical upstream are intentionally not replayed.

## Validation Coverage

Cover foreground resubscription, latest-sequence replay, deleted-thread stability, and avoidance of repeated deleted-thread subscriptions.
