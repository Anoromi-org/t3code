const HYPRLAND_ADDRESS = /^0x[0-9a-f]+$/iu;

function addressSelector(address: string): string {
  if (!HYPRLAND_ADDRESS.test(address)) {
    throw new Error(`Invalid Hyprland window address: ${address}`);
  }
  return JSON.stringify(`address:${address}`);
}

export function hyprlandFocusWorkspaceDispatcher(workspaceId: number): string {
  if (!Number.isSafeInteger(workspaceId) || workspaceId === 0) {
    throw new Error(`Invalid Hyprland workspace id: ${String(workspaceId)}`);
  }
  return `hl.dsp.focus({ workspace = ${String(workspaceId)} })`;
}

export function hyprlandFocusWindowDispatcher(address: string): string {
  return `hl.dsp.focus({ window = ${addressSelector(address)} })`;
}

export function hyprlandCloseWindowDispatcher(address: string): string {
  return `hl.dsp.window.close({ window = ${addressSelector(address)} })`;
}

export function hyprlandExecDispatcher(command: string, workspaceId?: number): string {
  const commandLiteral = JSON.stringify(command);
  if (workspaceId === undefined) return `hl.dsp.exec_cmd(${commandLiteral})`;
  if (!Number.isSafeInteger(workspaceId) || workspaceId === 0) {
    throw new Error(`Invalid Hyprland workspace id: ${String(workspaceId)}`);
  }
  return `hl.dsp.exec_cmd(${commandLiteral}, { workspace = ${JSON.stringify(`${String(workspaceId)} silent`)} })`;
}

export function hyprctlCommandError(result: {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}): string | null {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  const textualFailure = [stdout, stderr].find((value) => /^(?:error|warning):/iu.test(value));
  if (result.code === 0 && textualFailure === undefined) return null;
  return textualFailure || stderr || stdout || `hyprctl exited with code ${String(result.code)}`;
}
