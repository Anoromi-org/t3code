import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { afterEach, describe, expect, it } from "vite-plus/test";

const HELPER_PATH = NodeURL.fileURLToPath(
  new URL("../../../nix/local-launch-environment.sh", import.meta.url),
);
const HOME_MANAGER_MODULE_PATH = NodeURL.fileURLToPath(
  new URL("../../../nix/home-manager.nix", import.meta.url),
);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

async function makeRuntimeDirectory() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-wrapper-env-"));
  temporaryDirectories.push(directory);
  return directory;
}

function launchCapture(script, runtimeDirectory, extraArguments = []) {
  return NodeChildProcess.spawn(
    "bash",
    ["-c", `source "$1"; ${script}`, "t3code-wrapper-test", HELPER_PATH, ...extraArguments],
    {
      env: {
        HOME: "/home/captured-user",
        PATH: process.env.PATH,
        SHELL: "/bin/bash",
        USER_MARKER: "captured-before-nix",
        XDG_RUNTIME_DIR: runtimeDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function makeLineReader(stream) {
  const lines = [];
  const waiters = [];
  let buffered = "";
  let failure = null;
  const settle = () => {
    for (const waiter of waiters.splice(0, failure ? waiters.length : lines.length)) {
      if (lines.length > 0) waiter.resolve(lines.shift());
      else waiter.reject(failure);
    }
  };
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    let newline;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      lines.push(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
    }
    settle();
  });
  stream.once("error", (error) => {
    failure = error;
    settle();
  });
  stream.once("end", () => {
    failure = new Error("capture process exited before reporting the expected line");
    settle();
  });
  return () =>
    new Promise((resolve, reject) => {
      waiters.push({ resolve, reject });
      settle();
    });
}

async function makeSignalFixture(runtimeDirectory) {
  const fixturePath = NodePath.join(runtimeDirectory, "signal-fixture.sh");
  await NodeFSP.writeFile(
    fixturePath,
    `#!/usr/bin/env bash
set -u
signal=$1
parent_marker=$2
descendant_marker=$3
descendant_pid=
trap 'touch "$parent_marker"; wait "$descendant_pid" 2>/dev/null || true; exit 0' "$signal"
(
  trap 'touch "$descendant_marker"; exit 0' "$signal"
  echo ready
  while :; do sleep 1; done
) &
descendant_pid=$!
wait "$descendant_pid"
`,
    { mode: 0o755 },
  );
  return fixturePath;
}

describe("t3code-local environment capture", () => {
  it("captures PATH before the Home Manager launcher adds runtime tools", async () => {
    const moduleSource = await NodeFSP.readFile(HOME_MANAGER_MODULE_PATH, "utf8");
    const captureOffset = moduleSource.indexOf("t3code_capture_local_launch_environment");
    const pathExportOffset = moduleSource.indexOf("export PATH=");

    expect(captureOffset).toBeGreaterThan(-1);
    expect(pathExportOffset).toBeGreaterThan(captureOffset);
  });

  it("creates a private pre-Nix snapshot and removes it after a failed launch", async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const child = launchCapture(
      't3code_capture_local_launch_environment; printf "%s\\n" "$T3CODE_LOCAL_LAUNCH_ENV_FILE"; stat -c "%a" "$T3CODE_LOCAL_LAUNCH_ENV_FILE"; exit 47',
      runtimeDirectory,
    );
    const output = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => output.push(chunk));

    await expect(waitForExit(child)).resolves.toEqual({ code: 47, signal: null });
    const [snapshotPath, mode] = output.join("").trim().split("\n");
    expect(mode).toBe("600");
    await expect(NodeFSP.stat(snapshotPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    { signal: "TERM", nodeSignal: "SIGTERM", exitCode: 143 },
    { signal: "INT", nodeSignal: "SIGINT", exitCode: 130 },
  ])(
    "forwards $signal to the complete process group and removes its snapshot",
    async (signalCase) => {
      const runtimeDirectory = await makeRuntimeDirectory();
      const parentMarker = NodePath.join(runtimeDirectory, "parent-terminated");
      const descendantMarker = NodePath.join(runtimeDirectory, "descendant-terminated");
      const fixturePath = await makeSignalFixture(runtimeDirectory);
      const child = launchCapture(
        't3code_capture_local_launch_environment; printf "%s\\n" "$T3CODE_LOCAL_LAUNCH_ENV_FILE"; t3code_run_local_launch "$2" "$3" "$4" "$5"',
        runtimeDirectory,
        [fixturePath, signalCase.signal, parentMarker, descendantMarker],
      );
      const nextLine = makeLineReader(child.stdout);
      const snapshotPath = await nextLine();
      const snapshot = await NodeFSP.readFile(snapshotPath);
      expect(snapshot.includes(Buffer.from("USER_MARKER=captured-before-nix\0"))).toBe(true);
      expect(snapshot.includes(Buffer.from("T3CODE_LOCAL_LAUNCH_ENV_FILE="))).toBe(false);
      expect(await nextLine()).toBe("ready");

      const exit = waitForExit(child);
      child.kill(signalCase.nodeSignal);
      await expect(exit).resolves.toEqual({ code: signalCase.exitCode, signal: null });
      await expect(NodeFSP.stat(parentMarker)).resolves.toBeDefined();
      await expect(NodeFSP.stat(descendantMarker)).resolves.toBeDefined();
      await expect(NodeFSP.stat(snapshotPath)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
});
