import * as Exit from "effect/Exit";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Tracer from "effect/Tracer";
import { HttpClient } from "effect/unstable/http";
import { OtlpExporter, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import { settleAsyncResult, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary";
import { primaryEnvironmentHttpLayer } from "../environments/primary/httpLayer";
import { isElectron } from "../env";
import { APP_VERSION } from "~/branding";

const DEFAULT_EXPORT_INTERVAL_MS = 1_000;
const LONG_FRAME_ENTRY_TYPE = "long-animation-frame";
const LONG_TASK_ENTRY_TYPE = "longtask";
const MAX_SCRIPT_ATTRIBUTIONS = 5;
const MAX_ATTRIBUTION_VALUE_LENGTH = 128;
const CLIENT_TRACING_RESOURCE = {
  serviceName: "t3-web",
  attributes: {
    "service.runtime": "t3-web",
    "service.mode": isElectron ? "electron" : "browser",
    "service.version": APP_VERSION,
  },
} as const;

const delegateRuntimeLayer = Layer.mergeAll(
  primaryEnvironmentHttpLayer,
  OtlpExporter.layerFlusher,
  OtlpSerialization.layerJson,
  Layer.succeed(HttpClient.TracerDisabledWhen, () => true),
);

let activeDelegate: Tracer.Tracer | null = null;
let activeRuntime: ManagedRuntime.ManagedRuntime<never, never> | null = null;
let activeScope: Scope.Closeable | null = null;
let activeConfigKey: string | null = null;
let configurationGeneration = 0;
let pendingConfiguration = Promise.resolve();
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

export interface ClientTracingConfig {
  readonly exportIntervalMs?: number;
}

export const ClientTracingLive = Layer.succeed(
  Tracer.Tracer,
  Tracer.make({
    span(options) {
      return activeDelegate?.span(options) ?? new Tracer.NativeSpan(options);
    },
  }),
);

export function configureClientTracing(config: ClientTracingConfig = {}): Promise<void> {
  if (config.exportIntervalMs === undefined && activeConfigKey !== null) {
    return pendingConfiguration;
  }
  pendingConfiguration = pendingConfiguration.finally(() => applyClientTracingConfig(config));
  return pendingConfiguration;
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

  if (entry.renderStart !== undefined) {
    attributes["performance.render_delay_ms"] = Math.max(0, entry.renderStart - entry.startTime);
  }
  if (entry.styleAndLayoutStart !== undefined && entry.renderStart !== undefined) {
    attributes["performance.style_layout_ms"] = Math.max(
      0,
      entry.startTime + entry.duration - entry.styleAndLayoutStart,
    );
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
  if (activeDelegate === null) return;

  const startTime = BigInt(Math.round((performance.timeOrigin + entry.startTime) * 1_000_000));
  const endTime = startTime + BigInt(Math.round(entry.duration * 1_000_000));
  const span = activeDelegate.span({
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

async function applyClientTracingConfig(config: ClientTracingConfig): Promise<void> {
  const otlpTracesUrl = resolvePrimaryEnvironmentHttpUrl("/api/observability/v1/traces");
  const exportIntervalMs = Math.max(10, config.exportIntervalMs ?? DEFAULT_EXPORT_INTERVAL_MS);
  const nextConfigKey = `${otlpTracesUrl}|${exportIntervalMs}`;

  if (activeConfigKey === nextConfigKey && activeDelegate !== null) {
    return;
  }

  activeConfigKey = nextConfigKey;
  const generation = ++configurationGeneration;

  const previousRuntime = activeRuntime;
  const previousScope = activeScope;

  activeDelegate = null;
  activeRuntime = null;
  activeScope = null;

  await disposeTracerRuntime(previousRuntime, previousScope);

  const runtime = ManagedRuntime.make(delegateRuntimeLayer);
  const scope = runtime.runSync(Scope.make());

  const delegateResult = await settleAsyncResult(() =>
    runtime.runPromiseExit(
      Scope.provide(scope)(
        OtlpTracer.make({
          url: otlpTracesUrl,
          exportInterval: `${exportIntervalMs} millis`,
          resource: CLIENT_TRACING_RESOURCE,
        }),
      ),
    ),
  );
  if (delegateResult._tag === "Failure") {
    await disposeTracerRuntime(runtime, scope);

    if (generation === configurationGeneration) {
      const error = squashAtomCommandFailure(delegateResult);
      const tracesUrl = new URL(otlpTracesUrl);
      console.warn("Failed to configure client tracing exporter", {
        scheme: tracesUrl.protocol.replace(/:$/, ""),
        host: tracesUrl.hostname,
        port: tracesUrl.port || undefined,
        exportIntervalMs,
        ...safeErrorLogAttributes(error),
      });
    }
    return;
  }

  if (generation !== configurationGeneration) {
    await disposeTracerRuntime(runtime, scope);
    return;
  }

  activeDelegate = delegateResult.value;
  activeRuntime = runtime;
  activeScope = scope;
}

async function disposeTracerRuntime(
  runtime: ManagedRuntime.ManagedRuntime<never, never> | null,
  scope: Scope.Closeable | null,
): Promise<void> {
  if (runtime === null || scope === null) {
    return;
  }

  await settleAsyncResult(() => runtime.runPromiseExit(Scope.close(scope, Exit.void)));
  runtime.dispose();
}

export async function __resetClientTracingForTests() {
  configurationGeneration++;
  activeConfigKey = null;
  activeDelegate = null;
  pendingConfiguration = Promise.resolve();

  const runtime = activeRuntime;
  const scope = activeScope;
  activeRuntime = null;
  activeScope = null;
  performanceObserver?.disconnect();
  performanceObserver = null;

  await disposeTracerRuntime(runtime, scope);
}
