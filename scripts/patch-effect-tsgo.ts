// @effect-diagnostics nodeBuiltinImport:off - Prepare runs before the Effect-patched compiler is available.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

async function hashFile(path: string): Promise<Buffer> {
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest();
}

async function filesAreEqual(left: string, right: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([NodeFSP.stat(left), NodeFSP.stat(right)]);
  if (leftStat.size !== rightStat.size) return false;
  const [leftHash, rightHash] = await Promise.all([hashFile(left), hashFile(right)]);
  return leftHash.equals(rightHash);
}

async function removeStaleBackups(targetPath: string): Promise<void> {
  const directory = NodePath.dirname(targetPath);
  const stalePrefix = `${NodePath.basename(targetPath)}.original.`;
  const entries = await NodeFSP.readdir(directory);
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(stalePrefix))
      .map((entry) => NodeFSP.rm(NodePath.join(directory, entry), { force: true })),
  );
}

export async function ensureEffectTsgoPatched(input: {
  readonly sourcePath: string;
  readonly targetPath: string;
}): Promise<"already-patched" | "patched"> {
  const { sourcePath, targetPath } = input;
  await removeStaleBackups(targetPath);
  if (await filesAreEqual(sourcePath, targetPath)) {
    await NodeFSP.chmod(targetPath, 0o755);
    return "already-patched";
  }

  const backupPath = `${targetPath}.original`;
  const temporaryPath = `${targetPath}.t3code-${NodeCrypto.randomUUID()}.tmp`;
  try {
    await NodeFSP.copyFile(sourcePath, temporaryPath);
    await NodeFSP.chmod(temporaryPath, 0o755);
    try {
      await NodeFSP.copyFile(targetPath, backupPath, NodeFS.constants.COPYFILE_EXCL);
    } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EEXIST") throw cause;
    }
    await NodeFSP.rename(temporaryPath, targetPath);
    return "patched";
  } finally {
    await NodeFSP.rm(temporaryPath, { force: true });
  }
}

export function resolveEffectTsgoPaths(): {
  readonly sourcePath: string;
  readonly targetPath: string;
} {
  const require = NodeModule.createRequire(import.meta.url);
  const nativePreviewPackageJson = require.resolve("@typescript/native-preview/package.json");
  const nativePreviewRequire = NodeModule.createRequire(nativePreviewPackageJson);
  const effectTsgoPackageJson = require.resolve("@effect/tsgo/package.json");
  const effectTsgoRequire = NodeModule.createRequire(effectTsgoPackageJson);
  const platformSuffix = `${NodeProcess.platform}-${NodeProcess.arch}`;
  const binaryName = NodeProcess.platform === "win32" ? "tsgo.exe" : "tsgo";
  const nativePlatformPackageJson = nativePreviewRequire.resolve(
    `@typescript/native-preview-${platformSuffix}/package.json`,
  );
  const effectPlatformPackageJson = effectTsgoRequire.resolve(
    `@effect/tsgo-${platformSuffix}/package.json`,
  );
  return {
    sourcePath: NodePath.join(NodePath.dirname(effectPlatformPackageJson), "lib", binaryName),
    targetPath: NodePath.join(NodePath.dirname(nativePlatformPackageJson), "lib", binaryName),
  };
}

async function main(): Promise<void> {
  const result = await ensureEffectTsgoPatched(resolveEffectTsgoPaths());
  if (result === "patched") NodeProcess.stdout.write("Patched the Effect TypeScript-Go binary.\n");
}

if (import.meta.url === NodeURL.pathToFileURL(NodeProcess.argv[1] ?? "").href) await main();
