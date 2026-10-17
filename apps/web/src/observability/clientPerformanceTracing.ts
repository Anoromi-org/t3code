// Fork: traces browser long animation frames (or long tasks) as client spans so
// main-thread stalls can be diagnosed without recording URL contents.
import * as Context from "effect/Context";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import * as ClientTracer from "./clientTracer";

const LONG_FRAME_ENTRY_TYPE = "long-animation-frame";
const LONG_TASK_ENTRY_TYPE = "longtask";
const MAX_SCRIPT_ATTRIBUTIONS = 5;
const MAX_ATTRIBUTION_VALUE_LENGTH = 128;
let performanceObserver: PerformanceObserver | null = null;

interface PerformanceScriptAttribution {
  readonly duration?: number;
  readonly forcedStyleAndLayoutDuration?: number;
  readonly invoker?: string;
  readonly sourceFunctionName?: string;
  readonly sourceURL?: string;
}

interface LongAnimationFrameEntry extends PerformanceEntry {
  readonly blockingDuration?: number;
  readonly firstUIEventTimestamp?: number;
  readonly renderStart?: number;
  readonly styleAndLayoutStart?: number;
  readonly scripts?: ReadonlyArray<PerformanceScriptAttribution>;
}

interface BrowserPerformanceContext {
  readonly baseUrl: string;
  readonly route: string;
  readonly visibilityState: DocumentVisibilityState;
}
function boundedAttribution(value: string): string {
  return value.slice(0, MAX_ATTRIBUTION_VALUE_LENGTH);
}

function sanitizedRoute(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const stableRoot = new Set(["draft", "settings"]).has(segments[0] ?? "") ? segments[0] : "…";
  return boundedAttribution(`/${stableRoot}${segments.length > 1 ? "/…" : ""}`);
}

function compactSourceUrl(sourceUrl: string | undefined, baseUrl: string): string | undefined {
  if (!sourceUrl) return undefined;
  try {
    const url = new URL(sourceUrl, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return boundedAttribution(`${url.origin}/…`);
  } catch {
    return undefined;
  }
}

export function longAnimationFrameAttributes(
  entry: LongAnimationFrameEntry,
  context: BrowserPerformanceContext = {
    baseUrl: window.location.href,
    route: window.location.pathname,
    visibilityState: document.visibilityState,
  },
): Record<string, unknown> {
  const attributes: Record<string, unknown> = {
    "performance.entry_type": entry.entryType,
    "performance.duration_ms": entry.duration,
    "performance.blocking_duration_ms": entry.blockingDuration ?? 0,
    "performance.route": sanitizedRoute(context.route),
    "performance.visibility_state": context.visibilityState,
  };

  // Frames without rendering report zero for these timestamps.
  const renderStart = entry.renderStart ?? 0;
  const styleAndLayoutStart = entry.styleAndLayoutStart ?? 0;
  if (renderStart > 0) {
    attributes["performance.render_delay_ms"] = Math.max(0, renderStart - entry.startTime);
    if (styleAndLayoutStart > 0) {
      attributes["performance.style_layout_ms"] = Math.max(
        0,
        entry.startTime + entry.duration - styleAndLayoutStart,
      );
    }
  }
  if (entry.firstUIEventTimestamp !== undefined && entry.firstUIEventTimestamp > 0) {
    attributes["performance.first_ui_event_offset_ms"] =
      entry.firstUIEventTimestamp - entry.startTime;
  }

  const scripts = [...(entry.scripts ?? [])]
    .sort((left, right) => (right.duration ?? 0) - (left.duration ?? 0))
    .slice(0, MAX_SCRIPT_ATTRIBUTIONS);
  attributes["performance.script_count"] = entry.scripts?.length ?? 0;
  for (const [index, script] of scripts.entries()) {
    const prefix = `performance.script.${index}`;
    attributes[`${prefix}.duration_ms`] = script.duration ?? 0;
    attributes[`${prefix}.forced_style_layout_ms`] = script.forcedStyleAndLayoutDuration ?? 0;
    if (script.sourceFunctionName) {
      attributes[`${prefix}.function_name`] = boundedAttribution(script.sourceFunctionName);
    }
    if (script.invoker) attributes[`${prefix}.invoker`] = boundedAttribution(script.invoker);
    const sourceUrl = compactSourceUrl(script.sourceURL, context.baseUrl);
    if (sourceUrl) attributes[`${prefix}.source_url`] = sourceUrl;
  }

  return attributes;
}

function recordPerformanceEntry(entry: PerformanceEntry): void {
  const delegate = ClientTracer.currentDelegate();
  if (delegate === null) return;

  const startTime = BigInt(Math.round((performance.timeOrigin + entry.startTime) * 1_000_000));
  const endTime = startTime + BigInt(Math.round(entry.duration * 1_000_000));
  const span = delegate.span({
    name:
      entry.entryType === LONG_FRAME_ENTRY_TYPE
        ? "web.performance.long_animation_frame"
        : "web.performance.long_task",
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime,
    kind: "internal",
    root: true,
    sampled: true,
  });
  const attributes =
    entry.entryType === LONG_FRAME_ENTRY_TYPE
      ? longAnimationFrameAttributes(entry as LongAnimationFrameEntry)
      : {
          "performance.entry_type": entry.entryType,
          "performance.duration_ms": entry.duration,
          "performance.route": sanitizedRoute(window.location.pathname),
          "performance.visibility_state": document.visibilityState,
        };
  for (const [key, value] of Object.entries(attributes)) {
    span.attribute(key, value);
  }
  span.event("Browser main thread blocked.", endTime, {
    ...attributes,
    "effect.logLevel": "Warning",
  });
  span.end(endTime, Exit.void);
}

export function startClientPerformanceTracing(): void {
  if (performanceObserver !== null || typeof PerformanceObserver === "undefined") return;

  const supportedEntryTypes = PerformanceObserver.supportedEntryTypes;
  const entryType = supportedEntryTypes.includes(LONG_FRAME_ENTRY_TYPE)
    ? LONG_FRAME_ENTRY_TYPE
    : supportedEntryTypes.includes(LONG_TASK_ENTRY_TYPE)
      ? LONG_TASK_ENTRY_TYPE
      : null;
  if (entryType === null) return;

  performanceObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      recordPerformanceEntry(entry);
    }
  });
  performanceObserver.observe({ type: entryType, buffered: true });
}
