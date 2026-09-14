// @effect-diagnostics nodeBuiltinImport:off - Build tooling runs the compiler and writes the distributable package.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import effectPackage from "effect/package.json" with { type: "json" };
import packageJson from "../package.json" with { type: "json" };

// Bundling the inferred Effect schemas expands them repeatedly and exhausts the
// declaration bundler's heap. Preserve native compiler declarations instead.
for (const config of ["tsconfig.build.json", "tsconfig.contracts.json"]) {
  NodeChildProcess.execFileSync(
    process.execPath,
    [
      NodeURL.fileURLToPath(new URL("./bin/vp", import.meta.resolve("vite-plus/package.json"))),
      "exec",
      "tsgo",
      "-p",
      config,
    ],
    { stdio: "inherit" },
  );
}

// Publish from dist so unversioned private workspace dev dependencies never
// appear in the tarball. All of their runtime code is already bundled.
await NodeFSP.copyFile("README.md", "dist/README.md");
await NodeFSP.copyFile("../../LICENSE", "dist/LICENSE");
await NodeFSP.copyFile(
  new URL("./LICENSE", import.meta.resolve("effect/package.json")),
  "dist/LICENSE-effect",
);
for (const dependency of ["msgpackr", "multipasta"]) {
  await NodeFSP.copyFile(
    new URL(`../${dependency}/LICENSE`, import.meta.resolve("effect/package.json")),
    `dist/LICENSE-${dependency}`,
  );
}
await NodeFSP.copyFile("../shared/node_modules/jose/LICENSE.md", "dist/LICENSE-jose");
await NodeFSP.writeFile(
  "dist/package.json",
  JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      license: packageJson.license,
      repository: packageJson.repository,
      publishConfig: { access: packageJson.publishConfig.access },
      type: "module",
      exports: {
        ".": { types: "./index.d.ts", import: "./index.js" },
        "./react": { types: "./react.d.ts", import: "./react.js" },
        "./style.css": "./style.css",
        "./contracts": { types: "./contracts.d.ts", import: "./contracts.js" },
      },
      dependencies: { effect: effectPackage.version },
      peerDependencies: packageJson.peerDependencies,
      peerDependenciesMeta: packageJson.peerDependenciesMeta,
      engines: packageJson.engines,
    },
    null,
    2,
  ) + "\n",
);
for (const file of await NodeFSP.readdir("dist", { recursive: true })) {
  if (!file.endsWith(".d.ts")) continue;
  const path = NodePath.join("dist", file);
  const contents = await NodeFSP.readFile(path, "utf8");
  await NodeFSP.writeFile(
    path,
    contents
      .replaceAll('"@t3tools/contracts"', '"./contracts/index.js"')
      .replace(/(from\s+"\.[^"]+)\.ts"/g, '$1.js"'),
  );
}
