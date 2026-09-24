import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

const repoRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const sandboxScript = NodePath.join(repoRoot, "nix", "electron-sandbox.sh");

function evaluateSandbox({
  unshareWorks,
  helperExists = false,
  helperConfigured = helperExists,
  disableSandbox = false,
}) {
  const tempDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-sandbox-test-"));
  const unsharePath = NodePath.join(tempDir, "unshare");
  const helperPath = NodePath.join(tempDir, "chrome-sandbox");
  const statPath = NodePath.join(tempDir, "stat");
  const truePath = NodePath.join(tempDir, "true");
  NodeFS.writeFileSync(
    unsharePath,
    `#!/bin/sh\n[ "$1" = -Ur ] && [ "$2" = '${truePath}' ] && exit ${unshareWorks ? 0 : 1}\nexit 2\n`,
    { mode: 0o755 },
  );
  NodeFS.writeFileSync(truePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  if (helperExists) {
    NodeFS.writeFileSync(helperPath, "#!/bin/sh\n", { mode: 0o755 });
  }
  NodeFS.writeFileSync(
    statPath,
    `#!/bin/sh\ncase "$2" in %u) printf '${helperConfigured ? "0" : "1000"}\\n' ;; %a) printf '${helperConfigured ? "4755" : "755"}\\n' ;; esac\n`,
    { mode: 0o755 },
  );

  try {
    const result = NodeChildProcess.spawnSync(
      "bash",
      [
        "-c",
        'source "$1" "$2" "$3" "$4" "$5"; printf "args=%s\\nhelper=%s\\n" "${sandbox_args[*]}" "${CHROME_DEVEL_SANDBOX-unset}"',
        "bash",
        sandboxScript,
        unsharePath,
        helperPath,
        statPath,
        truePath,
      ],
      {
        encoding: "utf8",
        env: {
          ...NodeProcess.env,
          CHROME_DEVEL_SANDBOX: "/nix/store/electron/chrome-sandbox",
          T3CODE_DESKTOP_DISABLE_SANDBOX: disableSandbox ? "1" : "0",
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().replaceAll(tempDir, "<tmp>").split("\n");
  } finally {
    NodeFS.rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("Nix Electron sandbox selection", () => {
  it("uses a configured NixOS setuid sandbox helper", () => {
    assert.deepEqual(evaluateSandbox({ unshareWorks: false, helperExists: true }), [
      "args=",
      "helper=<tmp>/chrome-sandbox",
    ]);
  });

  it("uses user namespaces on Home Manager hosts without a system helper", () => {
    assert.deepEqual(evaluateSandbox({ unshareWorks: true }), [
      "args=--disable-setuid-sandbox",
      "helper=/nix/store/electron/chrome-sandbox",
    ]);
  });

  it("rejects a system helper without root ownership and mode 4755", () => {
    assert.deepEqual(
      evaluateSandbox({ unshareWorks: true, helperExists: true, helperConfigured: false }),
      ["args=--disable-setuid-sandbox", "helper=/nix/store/electron/chrome-sandbox"],
    );
  });

  it("starts without a sandbox when Ubuntu blocks unprivileged user namespaces", () => {
    assert.deepEqual(evaluateSandbox({ unshareWorks: false }), [
      "args=--no-sandbox",
      "helper=unset",
    ]);
  });

  it("honors the explicit disable-sandbox override", () => {
    assert.deepEqual(
      evaluateSandbox({ unshareWorks: true, helperExists: true, disableSandbox: true }),
      ["args=--no-sandbox", "helper=unset"],
    );
  });
});
