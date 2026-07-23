import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";
import { T3CODE_LOCAL_LAUNCH_ENV_FILE } from "./launch-environment.mjs";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");
const startElectron = NodePath.resolve(__dirname, "start-electron.mjs");
// oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone smoke runner has no Effect runtime.
const hostPlatform = NodeOS.platform();
const fatalPatterns = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
];

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readProcChildren(pid) {
  try {
    const contents = await NodeFSP.readFile(`/proc/${pid}/task/${pid}/children`, "utf8");
    return contents.trim().split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

async function listDescendants(rootPid) {
  const descendants = [];
  const pending = [rootPid];
  const visited = new Set(pending);
  while (pending.length > 0) {
    const parent = pending.shift();
    for (const child of await readProcChildren(parent)) {
      if (visited.has(child)) continue;
      visited.add(child);
      descendants.push(child);
      pending.push(child);
    }
  }
  return descendants;
}

async function readProcEnvironment(pid) {
  const contents = await NodeFSP.readFile(`/proc/${pid}/environ`);
  return Object.fromEntries(
    contents
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
}

async function waitForDesktopProcesses(launcherPid, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const directChildren = await readProcChildren(launcherPid);
    const descendants = await listDescendants(launcherPid);
    const electronPid = directChildren[0] ?? null;
    let backendPid = null;
    for (const pid of descendants) {
      let commandLine = "";
      try {
        commandLine = (await NodeFSP.readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll(
          "\0",
          " ",
        );
      } catch {
        continue;
      }
      if (commandLine.includes("apps/server/dist/bin.mjs")) backendPid = pid;
    }
    if (electronPid !== null && backendPid !== null) return { electronPid, backendPid };
    await delay(100);
  }
  throw new Error("Timed out waiting for the Electron application and primary backend.");
}

function assertCleanRuntimeEnvironment(label, environment, expected) {
  const failures = [];
  for (const [key, value] of Object.entries(expected)) {
    if (environment[key] !== value) failures.push(`${label}: expected ${key}=${value}`);
  }
  for (const key of [
    "NIX_BUILD_TOP",
    "IN_NIX_SHELL",
    "name",
    "PS1",
    "OPENSSL_DIR",
    "PKG_CONFIG_PATH",
  ]) {
    if (environment[key] !== undefined) failures.push(`${label}: leaked ${key}`);
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));
}

function assertPathProvides(label, environment, executable) {
  const found = environment.PATH?.split(NodePath.delimiter).some((directory) => {
    try {
      NodeFS.accessSync(NodePath.join(directory, executable), NodeFS.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) throw new Error(`${label}: PATH does not provide ${executable}`);
}

async function terminateProcessGroup(child) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  if (child.exitCode === null && child.signalCode === null) {
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  }
  // Electron can survive after its Node launcher exits and becomes reparented.
  // Always address the original process group so no descendant keeps the
  // smoke runner's pipes or temporary directory alive.
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
}

async function runLinuxEnvironmentSmoke() {
  const tempRoot = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3code-desktop-smoke-"));
  const snapshotPath = NodePath.join(tempRoot, "launch-environment");
  const userBin = NodePath.join(tempRoot, "user-bin");
  const home = NodePath.join(tempRoot, "home");
  await NodeFSP.mkdir(userBin, { recursive: true });
  await NodeFSP.mkdir(home, { recursive: true });

  const capturedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => {
      if (value === undefined) return false;
      if (
        key === T3CODE_LOCAL_LAUNCH_ENV_FILE ||
        key === "T3CODE_DESKTOP_ELECTRON_PATH" ||
        key === "VITE_DEV_SERVER_URL"
      ) {
        return false;
      }
      if (key === "IN_NIX_SHELL" || key === "name" || key === "PS1") return false;
      if (key.startsWith("NIX_") || key.startsWith("OPENSSL") || key.startsWith("PKG_CONFIG")) {
        return false;
      }
      return true;
    }),
  );
  Object.assign(capturedEnvironment, {
    HOME: home,
    PATH: [userBin, capturedEnvironment.PATH].filter(Boolean).join(NodePath.delimiter),
    SHELL: "/bin/bash",
    T3CODE_HOME: NodePath.join(tempRoot, "t3-home"),
    T3CODE_SMOKE_USER_ENV: "captured-before-nix",
    XDG_CACHE_HOME: NodePath.join(tempRoot, "cache"),
    XDG_CONFIG_HOME: NodePath.join(tempRoot, "config"),
    XDG_DATA_HOME: NodePath.join(tempRoot, "data"),
  });
  const serialized = `${Object.entries(capturedEnvironment)
    .map(([key, value]) => `${key}=${value}`)
    .join("\0")}\0`;
  await NodeFSP.writeFile(snapshotPath, serialized, { mode: 0o600 });

  const child = NodeChildProcess.spawn(process.execPath, [startElectron], {
    cwd: desktopDir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      [T3CODE_LOCAL_LAUNCH_ENV_FILE]: snapshotPath,
      SHELL: "/nix/store/poisoned-bash/bin/bash",
      PATH: "/nix/store/poisoned-bin",
      NIX_BUILD_TOP: "/tmp/nix-build-t3code-smoke",
      IN_NIX_SHELL: "impure",
      name: "nix-shell-env",
      PS1: "\\[poisoned\\]",
      OPENSSL_DIR: "/nix/store/poisoned-openssl",
      PKG_CONFIG_PATH: "/nix/store/poisoned-pkgconfig",
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));

  try {
    const { electronPid, backendPid } = await waitForDesktopProcesses(child.pid);
    const expected = {
      HOME: home,
      SHELL: "/bin/bash",
      T3CODE_SMOKE_USER_ENV: "captured-before-nix",
    };
    const electronEnvironment = await readProcEnvironment(electronPid);
    assertCleanRuntimeEnvironment("Electron", electronEnvironment, expected);
    const backendEnvironment = await readProcEnvironment(backendPid);
    assertCleanRuntimeEnvironment("backend", backendEnvironment, expected);
    for (const executable of ["xdg-open", "xdg-settings"]) {
      assertPathProvides("Electron", electronEnvironment, executable);
      assertPathProvides("backend", backendEnvironment, executable);
    }
    if (backendEnvironment.ELECTRON_RUN_AS_NODE !== "1") {
      throw new Error("backend: missing ELECTRON_RUN_AS_NODE bootstrap environment");
    }
    await NodeFSP.access(snapshotPath).then(
      () => {
        throw new Error("Launch environment snapshot was not deleted.");
      },
      () => undefined,
    );
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output}`, {
      cause: error,
    });
  } finally {
    await terminateProcessGroup(child);
    await NodeFSP.rm(tempRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }

  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (failures.length > 0)
    throw new Error(`Fatal desktop output: ${failures.join(", ")}\n${output}`);
}

async function runPortableSmoke() {
  const electronCommand = resolveElectronLaunchCommand([mainJs]);
  const environment = { ...process.env, ELECTRON_ENABLE_LOGGING: "1" };
  delete environment.VITE_DEV_SERVER_URL;
  const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: environment,
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  await delay(8_000);
  const closePromise = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("close", resolve);
  });
  if (child.exitCode === null && child.signalCode === null) child.kill();
  const closed = await Promise.race([
    closePromise.then(() => true),
    delay(2_000).then(() => false),
  ]);
  if (!closed) {
    child.kill("SIGKILL");
    await closePromise;
  }
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));
  if (failures.length > 0)
    throw new Error(`Fatal desktop output: ${failures.join(", ")}\n${output}`);
}

console.log("\nLaunching Electron smoke test...");
try {
  if (hostPlatform === "linux") await runLinuxEnvironmentSmoke();
  else await runPortableSmoke();
  console.log("Desktop smoke test passed.");
} catch (error) {
  console.error("\nDesktop smoke test failed:");
  console.error(error);
  process.exitCode = 1;
}
