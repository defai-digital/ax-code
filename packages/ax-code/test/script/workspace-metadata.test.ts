import { describe, expect, test } from "vitest"
import { readFile } from "fs/promises"
import path from "path"

function extractWorkspaceGlobs(pnpmWorkspaceYaml: string) {
  return [...pnpmWorkspaceYaml.matchAll(/^  - (.+)$/gm)].map((match) => match[1])
}

describe("script.workspace-metadata", () => {
  test("root package.json workspaces stay aligned with pnpm-workspace.yaml", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
    const pnpmWorkspaceYaml = await readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8")

    expect(packageJson.workspaces).toEqual(extractWorkspaceGlobs(pnpmWorkspaceYaml))
  })

  test("OpenTUI peer exceptions stay scoped to opentui-spinner", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
    const allowedVersions = packageJson.pnpm?.peerDependencyRules?.allowedVersions ?? {}
    const opentuiRules = Object.fromEntries(
      Object.entries(allowedVersions).filter(([selector]) => selector.includes("@opentui/")),
    )

    expect(opentuiRules).toEqual({
      "opentui-spinner@0.0.6>@opentui/core": "0.4.1",
      "opentui-spinner@0.0.6>@opentui/solid": "0.4.1",
    })
  })

  test("OpenTUI dependencies stay on the validated renderer set", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf8"))
    const dependencies = packageJson.dependencies ?? {}

    expect(dependencies["@opentui/core"]).toBe("0.4.1")
    expect(dependencies["@opentui/solid"]).toBe("0.4.1")
    expect(dependencies["@opentui/keymap"]).toBeUndefined()
    expect(dependencies["opentui-spinner"]).toBe("0.0.6")
  })
})
