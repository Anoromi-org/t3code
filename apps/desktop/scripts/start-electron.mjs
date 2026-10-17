import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { desktopDir, resolveElectronLaunchCommand } from "./electron-launcher.mjs";
import { resolveElectronRuntimeEnvironment } from "./launch-environment.mjs";
import { resolveDesktopOzoneArgs, resolveDesktopOzoneEnv } from "./runtime-args.mjs";

NodeChildProcess.execFileSync(
  process.execPath,
  [NodePath.join(desktopDir, "scripts/build-browser-secret.mjs")],
  { stdio: "inherit" },
);

const childEnv = await resolveElectronRuntimeEnvironment(process.env);
Object.assign(childEnv, resolveDesktopOzoneEnv(childEnv));
delete childEnv.ELECTRON_RUN_AS_NODE;

const electronCommand = resolveElectronLaunchCommand([
  ...resolveDesktopOzoneArgs(childEnv),
  ".",
  ...process.argv.slice(2),
]);
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: "inherit",
  cwd: desktopDir,
  env: childEnv,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
