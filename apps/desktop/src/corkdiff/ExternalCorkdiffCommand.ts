// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const CORKDIFF_GHOSTTY_CLASS_PREFIX = "dev.t3tools.t3code.corkdiff";

interface CorkdiffConnectionInput {
  readonly serverUrl: string;
  readonly token?: string;
}

export function createCorkdiffGhosttyClassName(threadId: string): string {
  const suffix = NodeCrypto.createHash("sha256").update(threadId).digest("hex").slice(0, 12);
  return `${CORKDIFF_GHOSTTY_CLASS_PREFIX}.t${suffix}`;
}

export function createCorkdiffNvimServerAddress(
  threadId: string,
  runtimeEnv: NodeJS.ProcessEnv,
): string {
  const suffix = NodeCrypto.createHash("sha256").update(threadId).digest("hex").slice(0, 12);
  const runtimeDirectory = runtimeEnv.XDG_RUNTIME_DIR?.trim() || NodeOS.tmpdir();
  return NodePath.join(runtimeDirectory, `t3code-corkdiff-${suffix}.sock`);
}

function quoteVimSingle(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildCorkdiffConnectionUpdateExpression(
  connection: CorkdiffConnectionInput,
): string {
  const payload = JSON.stringify({
    serverUrl: connection.serverUrl,
    token: connection.token ?? "",
  });
  return `luaeval("(function(payload) local value=vim.json.decode(payload) local config=require('codediff.config').options.t3code config.server_url=value.serverUrl config.token=value.token return true end)(_A)", ${quoteVimSingle(payload)})`;
}

export function buildCorkdiffGhosttyArgs(input: {
  readonly className: string;
  readonly nvimServerAddress?: string;
  readonly threadId: string;
}): readonly string[] {
  return [
    "--gtk-single-instance=false",
    `--class=${input.className}`,
    `--title=T3 Code Corkdiff ${input.threadId}`,
    "-e",
    "nvim",
    ...(input.nvimServerAddress ? ["--listen", input.nvimServerAddress] : []),
    "-c",
    "lua require('codediff.config').options.t3code.server_url=vim.env.T3CODE_SERVER_URL",
    "-c",
    "lua vim.api.nvim_cmd({cmd='CorkDiff',args={'t3code',vim.env.T3CODE_THREAD_ID}}, {})",
  ];
}
