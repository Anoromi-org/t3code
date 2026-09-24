import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrationsUnserialized } from "../Migrations.ts";
import * as SqliteClient from "@t3tools/shared/nodeSqliteClient";

const filename = process.argv[2];

if (filename === undefined) {
  throw new Error("Expected a SQLite filename");
}

Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA busy_timeout = 1`;
  yield* Effect.callback<void>((resume) => {
    const onMessage = (message: unknown) => {
      if (message !== "start") return;
      process.off("message", onMessage);
      resume(Effect.void);
    };
    process.on("message", onMessage);
    process.send?.("ready");
  });
  yield* runMigrationsUnserialized();
}).pipe(Effect.provide(SqliteClient.layer({ filename })), NodeRuntime.runMain);
