import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/react.tsx", "src/contracts.ts"],
    dts: false,
    platform: "neutral",
    // Preserve T3's patched RPC heartbeat in downstream installs as well.
    deps: {
      alwaysBundle: [/^@t3tools\//, /^effect(?:\/|$)/],
      neverBundle: [/^react(?:\/|$)/],
      onlyBundle: false,
    },
    copy: [{ from: "src/style.css", to: "dist" }],
  },
  test: { environment: "node", include: ["src/**/*.test.ts", "src/**/*.test.tsx"] },
});
