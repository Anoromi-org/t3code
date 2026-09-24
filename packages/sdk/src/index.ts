export {
  connect,
  pair,
  type Client,
  type ConnectOptions,
  type PairOptions,
  type Credential,
} from "./client.ts";
export { createConnection, type Connection, type ConnectionState } from "./connection.ts";
export { SdkConnectionError, type RpcMethods, type CallOptions } from "./rpc.ts";
export {
  WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  CommandId,
  ProjectId,
  ThreadId,
  MessageId,
  TurnId,
} from "@t3tools/contracts";
export type { ClientOrchestrationCommand, AuthEnvironmentScope } from "@t3tools/contracts";
