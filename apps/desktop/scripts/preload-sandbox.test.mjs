import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const PRELOAD_PATH = NodeURL.fileURLToPath(new URL("../src/preload.ts", import.meta.url));
const ALLOWED_RUNTIME_PACKAGES = new Set(["@clerk/electron/preload", "electron"]);

describe("sandboxed desktop preload", () => {
  it("does not import external runtime packages that Electron cannot load", async () => {
    const source = await NodeFSP.readFile(PRELOAD_PATH, "utf8");
    const runtimePackages = Array.from(
      source.matchAll(/^import(?!\s+type\b).*?from\s+["']([^"']+)["'];?$/gmu),
      (match) => match[1],
    ).filter((specifier) => specifier !== undefined && !specifier.startsWith("."));

    expect(runtimePackages).toEqual([...ALLOWED_RUNTIME_PACKAGES]);
  });
});
