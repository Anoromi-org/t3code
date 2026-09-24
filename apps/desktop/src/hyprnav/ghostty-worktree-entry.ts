import { runCli } from "../../../../scripts/ghostty-worktree.ts";

void runCli(process.argv.slice(2), process).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
