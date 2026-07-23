import { describe, expect, it } from "@effect/vitest";
import * as NodeURL from "node:url";

const repoRootUrl = new URL("../", import.meta.url);
const repoRoot = NodeURL.fileURLToPath(repoRootUrl);
const WINDOWS_FORBIDDEN_FILENAME_CHARACTERS = new Set('<>:"/\\|?*');

async function readRepoFile(relativePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile(new URL(relativePath, repoRootUrl), "utf8");
}

function stripJsoncComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
}

function commitSubjectToSpecPath(subject: string): string {
  const safeSubject = [...subject]
    .map((character) =>
      character.codePointAt(0)! < 32 || WINDOWS_FORBIDDEN_FILENAME_CHARACTERS.has(character)
        ? "-"
        : character,
    )
    .join("")
    .replace(/[. ]+$/g, "");
  return `${repoRoot}commits/${safeSubject}.md`;
}

async function runGit(args: readonly string[]): Promise<{ exitCode: number; stdout: string }> {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout,
  };
}

describe("repo configuration and branch metadata", () => {
  it("parses btca.config.jsonc and declares named resources", async () => {
    const config = JSON.parse(stripJsoncComments(await readRepoFile("btca.config.jsonc"))) as {
      resources?: Array<{ name?: string; type?: string }>;
    };

    expect(config.resources?.some((resource) => resource.name === "monaco-vim")).toBe(true);
    expect(config.resources?.every((resource) => typeof resource.type === "string")).toBe(true);
  });

  it("keeps AGENTS.md aligned with test, BTCA, and rebase workflow requirements", async () => {
    const agents = await readRepoFile("AGENTS.md");
    const criticalWorkflow = agents.slice(agents.indexOf("## Critical Workflow"));

    expect(agents).toContain("NEVER run `bun test`. Always use `bun run test`");
    expect(agents).toContain(".agents/uncodixify/AGENTS.md");
    expect(criticalWorkflow.indexOf("listResources")).toBeGreaterThanOrEqual(0);
    expect(criticalWorkflow.indexOf("listResources")).toBeLessThan(criticalWorkflow.indexOf("ask"));
    expect(agents).toContain("t3code-rebase-conflict-resolution");
  });

  it("installs the project rebase skill with persistence and orchestration guidance", async () => {
    const skill = await readRepoFile(".codex/skills/t3code-rebase-conflict-resolution/SKILL.md");

    expect(skill).toContain("persistence");
    expect(skill).toContain("orchestration");
    expect(skill).toContain("migrations");
    expect(skill).toContain("projections");
    expect(skill).toContain("settings");
  });

  it("has a commit spec file for each commit currently above canonical upstream/main", async () => {
    const baseRef = "upstream/main";
    const baseExists = (await runGit(["rev-parse", "--verify", baseRef])).exitCode === 0;
    if (!baseExists) {
      if (process.env.CI) {
        throw new Error(
          "Missing upstream/main. CI must fetch canonical upstream before validating commit specs.",
        );
      }
      return;
    }

    const subjects = (
      await runGit(["log", "--no-merges", "--format=%s", `${baseRef}..HEAD`])
    ).stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const fs = await import("node:fs/promises");
    for (const subject of subjects) {
      const specPath = commitSubjectToSpecPath(subject);
      await expect(
        fs.access(specPath).then(() => true),
        specPath,
      ).resolves.toBe(true);
      expect(await fs.readFile(specPath, "utf8")).toContain("# ");
    }
  });
});
