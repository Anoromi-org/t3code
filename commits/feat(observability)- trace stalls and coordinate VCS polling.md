# feat(observability): trace stalls and coordinate VCS polling

## Goal

Trace browser main-thread stalls with bounded, sanitized telemetry, and keep background VCS
polling cheap across many worktrees of one repository.

## Included Changes

- `clientPerformanceTracing.ts` observes `long-animation-frame` entries (falling back to
  `longtask`) and records each as a client span through the configured exporter
  (`clientTracer.currentDelegate()`), with the slowest script attributions, render and layout
  timings only for frames that rendered, a sanitized route, and origin-only source URLs. It starts
  after `configureClientTracing()` in the authenticated tracing bootstrap.

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

Reapplied onto upstream `13aa882c22` from fork commit `0169912a61` (itself from `53e12c4f55`).
