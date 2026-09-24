# Client harden thread resynchronization on app activation

Use upstream's authoritative thread synchronization as the base while retaining fork-only activation safeguards: a deleted thread ignores foreground wakeups (`application-active` and `application-active-probe`) instead of resubscribing, and a replacement RPC session resumes a deleted thread from the sequence its deletion was applied at rather than requesting a full snapshot.

## Reimplementation Sources

Reapplies fork commit `f8e0fd92ec`; upstream supersedes source commit `2ecaf890a`. Relevant follow-ups from `53f613927`, `d8720cdf2`, `679a18437` are represented here; patches already identical upstream are intentionally not replayed. The fork's `index.css` view-transition selector reformat (`7e59c22d2`) is dropped because the current formatter accepts upstream's single-line selector.

## Validation Coverage

`threads-sync.test.ts`: foreground wakeups leave a deleted thread with its single subscription and no HTTP reload; a replaced session resumes a deleted thread with `afterSequence` at the deletion cursor.
