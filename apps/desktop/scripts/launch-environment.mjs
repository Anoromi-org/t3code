import * as NodeFSP from "node:fs/promises";

export const T3CODE_LOCAL_LAUNCH_ENV_FILE = "T3CODE_LOCAL_LAUNCH_ENV_FILE";

const REQUIRED_LAUNCH_ENV_KEYS = ["HOME", "PATH", "SHELL"];
const RUNTIME_OVERRIDE_KEYS = [
  "T3CODE_DESKTOP_OZONE_PLATFORM",
  "T3CODE_DESKTOP_LINUX_DESKTOP_ENTRY_NAME",
];

export function parseNullDelimitedLaunchEnvironment(contents) {
  const text = Buffer.isBuffer(contents) ? contents.toString("utf8") : String(contents);
  if (!text.endsWith("\0")) {
    throw new Error("Launch environment snapshot is not NUL terminated.");
  }

  const environment = {};
  const entries = text.slice(0, -1).split("\0");
  for (const entry of entries) {
    if (entry.length === 0) {
      throw new Error("Launch environment snapshot contains an empty entry.");
    }
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error("Launch environment snapshot contains a malformed entry.");
    }

    const key = entry.slice(0, separatorIndex);
    if (Object.hasOwn(environment, key)) {
      throw new Error(`Launch environment snapshot contains a duplicate key: ${key}`);
    }
    environment[key] = entry.slice(separatorIndex + 1);
  }

  for (const key of REQUIRED_LAUNCH_ENV_KEYS) {
    if (!environment[key]?.trim()) {
      throw new Error(`Launch environment snapshot is missing required variable ${key}.`);
    }
  }

  return environment;
}

export function projectCapturedLaunchEnvironment(capturedEnv, currentEnv) {
  const environment = { ...capturedEnv };
  delete environment[T3CODE_LOCAL_LAUNCH_ENV_FILE];

  for (const key of RUNTIME_OVERRIDE_KEYS) {
    const value = currentEnv[key];
    if (value !== undefined) environment[key] = value;
  }

  return environment;
}

export async function resolveElectronRuntimeEnvironment(currentEnv, fileSystem = NodeFSP) {
  const snapshotPath = currentEnv[T3CODE_LOCAL_LAUNCH_ENV_FILE]?.trim();
  if (!snapshotPath) return { ...currentEnv };

  let capturedEnv;
  let readError;
  try {
    const contents = await fileSystem.readFile(snapshotPath);
    capturedEnv = parseNullDelimitedLaunchEnvironment(contents);
  } catch (error) {
    readError = error;
  }

  let cleanupError;
  try {
    await fileSystem.unlink(snapshotPath);
  } catch (error) {
    cleanupError = error;
  }

  if (readError || cleanupError) {
    const causes = [readError, cleanupError].filter(Boolean);
    throw new AggregateError(
      causes,
      `Unable to restore the pre-Nix launch environment from ${snapshotPath}.`,
    );
  }

  return projectCapturedLaunchEnvironment(capturedEnv, currentEnv);
}
