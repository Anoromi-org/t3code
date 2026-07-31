import { describe, expect, it } from "vitest";

import { longAnimationFrameAttributes } from "./clientTracing";

describe("client performance tracing", () => {
  it("records the slowest scripts without URL query data", () => {
    const attributes = longAnimationFrameAttributes(
      {
        name: "long-animation-frame",
        entryType: "long-animation-frame",
        startTime: 100,
        duration: 180,
        blockingDuration: 90,
        renderStart: 240,
        styleAndLayoutStart: 260,
        toJSON: () => ({}),
        scripts: [
          {
            duration: 40,
            sourceFunctionName: "smaller",
            sourceURL: "data:text/javascript,secret",
          },
          {
            duration: 120,
            sourceFunctionName: "largest",
            sourceURL: "https://app.test/largest.js?token=secret",
          },
          {
            duration: 80,
            sourceFunctionName: "malformed",
            sourceURL: "http://[invalid]?token=secret",
          },
        ],
      },
      {
        baseUrl: "https://app.test/thread/1",
        route: "/thread/1",
        visibilityState: "visible",
      },
    );

    expect(attributes).toMatchObject({
      "performance.duration_ms": 180,
      "performance.blocking_duration_ms": 90,
      "performance.render_delay_ms": 140,
      "performance.style_layout_ms": 20,
      "performance.script_count": 3,
      "performance.script.0.duration_ms": 120,
      "performance.script.0.function_name": "largest",
      "performance.route": "/…/…",
      "performance.script.0.source_url": "https://app.test/…",
      "performance.script.1.function_name": "malformed",
    });
    expect(attributes).not.toHaveProperty("performance.script.1.source_url");
    expect(attributes).not.toHaveProperty("performance.script.2.source_url");
  });

  it("bounds attribution strings and redacts sensitive path segments", () => {
    const sensitive = "secret-token-" + "x".repeat(200);
    const attributes = longAnimationFrameAttributes(
      {
        name: "long-animation-frame",
        entryType: "long-animation-frame",
        startTime: 0,
        duration: 100,
        toJSON: () => ({}),
        scripts: [
          {
            duration: 100,
            sourceFunctionName: "f".repeat(300),
            invoker: "i".repeat(300),
            sourceURL: `https://app.test/assets/${sensitive}/bundle.js?token=${sensitive}`,
          },
        ],
      },
      {
        baseUrl: "https://app.test/",
        route: `/thread/${sensitive}/settings`,
        visibilityState: "visible",
      },
    );

    expect(attributes["performance.route"]).toBe("/…/…");
    expect(attributes["performance.script.0.source_url"]).toBe("https://app.test/…");
    expect(String(attributes["performance.script.0.function_name"])).toHaveLength(128);
    expect(String(attributes["performance.script.0.invoker"])).toHaveLength(128);
    expect(JSON.stringify(attributes)).not.toContain(sensitive);
  });
});
