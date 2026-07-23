import { describe, expect, it } from "@effect/vitest";

const repoRootUrl = new URL("../", import.meta.url);

async function readRepoFile(relativePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile(new URL(relativePath, repoRootUrl), "utf8");
}

describe("workflow configuration", () => {
  it("keeps release workflow wired for desktop artifact publishing", async () => {
    const workflow = await readRepoFile(".github/workflows/release.yml");

    expect(workflow).toContain("dist:desktop:artifact");
    expect(workflow).toContain("AppImage");
  });

  it("uses the upstream Vite+ and pnpm workspace architecture", async () => {
    const packageJson = JSON.parse(await readRepoFile("package.json")) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const workspace = await readRepoFile("pnpm-workspace.yaml");
    const ciWorkflow = await readRepoFile(".github/workflows/ci.yml");

    expect(packageJson.packageManager).toMatch(/^pnpm@/);
    expect(packageJson.scripts?.test).toContain("vp run");
    expect(workspace).toContain("oxlint-plugin-t3code");
    expect(workspace).toContain("apps/*");
    expect(workspace).toContain("packages/*");
    expect(ciWorkflow).toContain("voidzero-dev/setup-vp");
    expect(ciWorkflow).toContain("vp check");
    expect(ciWorkflow).toContain("fetch-depth: 0");
    expect(ciWorkflow).toContain("git fetch --no-tags upstream main");
  });
});
