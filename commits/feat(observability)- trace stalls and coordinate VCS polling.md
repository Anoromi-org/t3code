# feat(observability): trace stalls and coordinate VCS polling

## Goal

Trace browser main-thread stalls with bounded, sanitized telemetry, and keep background VCS
polling cheap across many worktrees of one repository.

## Included Changes

- `clientPerformanceTracing.ts` observes `long-animation-frame` entries (falling back to
  `longtask`) and records each as a client span through the configured exporter
  (`clientTracer.currentDelegate()`), with the slowest script attributions, render and layout
  timings only for frames that rendered, a sanitized route, and origin-only source URLs. Slow
  interactions (`event` entries) split into input delay, processing, and presentation. It starts
  after `configureClientTracing()` in upstream's root route `beforeLoad`, which runs on every
  navigation, so starting is idempotent.

## Superseded by upstream

- Server event-loop stall tracing: upstream's `observability/EventLoopMonitor.ts`.
- VCS fetch coordination: upstream's `refreshStatusUpstreamIfStale` already shares one status
  fetch per git common directory and remote through a TTL cache, Git processes are bounded by its
  process limiter, and failing refreshes back off per poller. The fork's broadcaster rewrite is
  dropped.

## Validation Coverage

`clientPerformanceTracing.test.ts` covers script attribution, query-free URLs, omitted render
timings for frames that did not render, and bounded, redacted attribution strings.

## Reimplementation Sources

Reapplied onto upstream `721542cac7` from fork commit `7448c24a1f` plus the slow-interaction split
from `b5071e4393` (previously onto `13aa882c22` from its own source commits).
