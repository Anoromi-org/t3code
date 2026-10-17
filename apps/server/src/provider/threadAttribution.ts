/**
 * Fork: lets processes an agent starts attribute their work to the owning T3
 * Code thread. Provider processes get `T3CODE_THREAD_ID` (and
 * `T3CODE_ENVIRONMENT_ID` once an MCP session exists), and a Codex MCP server
 * named by `T3CODE_CODEX_THREAD_MCP_SERVER` gets both through its `env` table.
 */
export const T3CODE_CODEX_THREAD_MCP_SERVER_ENV = "T3CODE_CODEX_THREAD_MCP_SERVER";

export interface ThreadAttribution {
  readonly threadId: string;
  readonly environmentId?: string | undefined;
}

function attributionValues(attribution: ThreadAttribution): Record<string, string> {
  return {
    T3CODE_THREAD_ID: attribution.threadId,
    ...(attribution.environmentId ? { T3CODE_ENVIRONMENT_ID: attribution.environmentId } : {}),
  };
}

/**
 * The provider process environment with thread attribution layered on top. An
 * absent environment means the provider inherits the server's own.
 */
export function withThreadAttributionEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  attribution: ThreadAttribution | null,
): NodeJS.ProcessEnv {
  const base = environment ?? process.env;
  return attribution === null ? base : { ...base, ...attributionValues(attribution) };
}

/**
 * Codex config overrides that add thread attribution to one configured MCP
 * server's environment. Dotted keys merge into the user's server entry. Only a
 * plain server name is accepted, so the override cannot reach another key.
 */
export function codexThreadMcpAttributionConfig(
  server: string | undefined,
  attribution: ThreadAttribution | null,
): Record<string, string> {
  const name = server?.trim();
  if (attribution === null || !name || !/^[A-Za-z0-9_-]+$/.test(name)) return {};
  return Object.fromEntries(
    Object.entries(attributionValues(attribution)).map(([key, value]) => [
      `mcp_servers.${name}.env.${key}`,
      value,
    ]),
  );
}
