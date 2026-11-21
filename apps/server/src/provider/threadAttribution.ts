import { AGENT_THREAD_ENV } from "../preview/PortScanner.ts";

/**
 * Fork: processes an agent starts can attribute their work to the owning environment as well as
 * upstream's `T3CODE_THREAD_ID` thread, once the thread has an MCP session that names it.
 */
export const AGENT_ENVIRONMENT_ENV = "T3CODE_ENVIRONMENT_ID";

/** The attribution variables a provider process gets on top of its environment. */
export function threadAttributionEnvironment(attribution: {
  readonly threadId: string;
  readonly environmentId?: string | undefined;
}): Record<string, string> {
  return {
    [AGENT_THREAD_ENV]: attribution.threadId,
    ...(attribution.environmentId === undefined
      ? {}
      : { [AGENT_ENVIRONMENT_ENV]: attribution.environmentId }),
  };
}
