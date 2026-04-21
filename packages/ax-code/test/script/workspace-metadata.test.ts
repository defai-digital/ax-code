import { describe, expect, test } from "bun:test"
import { readFile } from "fs/promises"
import path from "path"

function extractWorkspaceGlobs(pnpmWorkspaceYaml: string) {
  return [...pnpmWorkspaceYaml.matchAll(/^  - (.+)$/gm)].map((match) => match[1])
}

describe("script.workspace-metadata", () => {
  test("root package.json workspaces stay aligned with pnpm-workspace.yaml", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
    const pnpmWorkspaceYaml = await readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8")

    expect(packageJson.workspaces).toEqual(extractWorkspaceGlobs(pnpmWorkspaceYaml))
  })
})
