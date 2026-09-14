import { connect, ORCHESTRATION_WS_METHODS } from "../dist/index.js";

const url = process.env.T3_URL;
const token = process.env.T3_TOKEN;
if (!url || !token) throw new Error("Set T3_URL and T3_TOKEN before running this example.");
const client = await connect({ url, token });
try {
  for await (const item of client.rpc[ORCHESTRATION_WS_METHODS.subscribeShell]({})) {
    if (item.kind !== "snapshot") continue;
    for (const project of item.snapshot.projects) console.log(project.title);
    break;
  }
} finally {
  await client.close();
}
