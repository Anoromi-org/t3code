// @effect-diagnostics nodeBuiltinImport:off - Tests exercise the prepare-time filesystem boundary directly.
import { assert, describe, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { ensureEffectTsgoPatched } from "./patch-effect-tsgo.ts";

async function withTemporaryDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-tsgo-"));
  try {
    await run(directory);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
}

describe("ensureEffectTsgoPatched", () => {
  it("reuses a current patch and removes stale numbered backups", async () => {
    await withTemporaryDirectory(async (directory) => {
      const sourcePath = NodePath.join(directory, "source");
      const targetPath = NodePath.join(directory, "target");
      await NodeFSP.writeFile(sourcePath, "effect-tsgo");
      await NodeFSP.writeFile(targetPath, "effect-tsgo");
      await NodeFSP.writeFile(`${targetPath}.original`, "typescript-go");
      await NodeFSP.writeFile(`${targetPath}.original.1`, "stale");

      const result = await ensureEffectTsgoPatched({ sourcePath, targetPath });

      assert.equal(result, "already-patched");
      assert.equal((await NodeFSP.stat(targetPath)).mode & 0o777, 0o755);
      assert.equal(await NodeFSP.readFile(`${targetPath}.original`, "utf8"), "typescript-go");
      assert.deepStrictEqual((await NodeFSP.readdir(directory)).sort(), [
        "source",
        "target",
        "target.original",
      ]);
    });
  });

  it("preserves the original binary on the first patch", async () => {
    await withTemporaryDirectory(async (directory) => {
      const sourcePath = NodePath.join(directory, "source");
      const targetPath = NodePath.join(directory, "target");
      await NodeFSP.writeFile(sourcePath, "effect-tsgo");
      await NodeFSP.writeFile(targetPath, "typescript-go");

      const result = await ensureEffectTsgoPatched({ sourcePath, targetPath });

      assert.equal(result, "patched");
      assert.equal(await NodeFSP.readFile(targetPath, "utf8"), "effect-tsgo");
      assert.equal((await NodeFSP.stat(targetPath)).mode & 0o777, 0o755);
      assert.equal(await NodeFSP.readFile(`${targetPath}.original`, "utf8"), "typescript-go");
    });
  });

  it("updates a stale patch without replacing the original backup", async () => {
    await withTemporaryDirectory(async (directory) => {
      const sourcePath = NodePath.join(directory, "source");
      const targetPath = NodePath.join(directory, "target");
      await NodeFSP.writeFile(sourcePath, "new-effect-tsgo");
      await NodeFSP.writeFile(targetPath, "old-effect-tsgo");
      await NodeFSP.writeFile(`${targetPath}.original`, "typescript-go");

      const result = await ensureEffectTsgoPatched({ sourcePath, targetPath });

      assert.equal(result, "patched");
      assert.equal(await NodeFSP.readFile(targetPath, "utf8"), "new-effect-tsgo");
      assert.equal(await NodeFSP.readFile(`${targetPath}.original`, "utf8"), "typescript-go");
    });
  });

  it("preserves one original backup when patches run concurrently", async () => {
    await withTemporaryDirectory(async (directory) => {
      const sourcePath = NodePath.join(directory, "source");
      const targetPath = NodePath.join(directory, "target");
      await NodeFSP.writeFile(sourcePath, "effect-tsgo");
      await NodeFSP.writeFile(targetPath, "typescript-go");

      await Promise.all([
        ensureEffectTsgoPatched({ sourcePath, targetPath }),
        ensureEffectTsgoPatched({ sourcePath, targetPath }),
      ]);

      assert.equal(await NodeFSP.readFile(targetPath, "utf8"), "effect-tsgo");
      assert.equal(await NodeFSP.readFile(`${targetPath}.original`, "utf8"), "typescript-go");
      assert.deepStrictEqual((await NodeFSP.readdir(directory)).sort(), [
        "source",
        "target",
        "target.original",
      ]);
    });
  });
});
