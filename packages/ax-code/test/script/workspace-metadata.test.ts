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
      Object.entries(allowedVersions).filter(([selector]) => selector.includes("@ax-code/opentui")),
    )

    expect(opentuiRules).toEqual({})
  })

  test("OpenTUI dependencies stay on the validated renderer set", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf8"))
    const tsconfig = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/tsconfig.json"), "utf8"))
    const dependencies = packageJson.dependencies ?? {}

    expect(dependencies["@ax-code/opentui-core"]).toBe("workspace:*")
    expect(dependencies["@ax-code/opentui-solid"]).toBe("workspace:*")
    expect(dependencies["@ax-code/opentui-keymap"]).toBeUndefined()
    expect(dependencies["@ax-code/opentui-spinner"]).toBe("workspace:*")
    expect(tsconfig.compilerOptions?.jsxImportSource).toBe("@ax-code/opentui-solid")
  })

  test("vendored OpenTUI JSX runtime resolves through the scoped workspace package", async () => {
    await expect(import("@ax-code/opentui-solid/jsx-runtime")).resolves.toMatchObject({
      jsx: expect.any(Function),
    })
  })

  test("vendored OpenTUI transform is a stable exported build API", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const solidPackage = JSON.parse(await readFile(path.join(repoRoot, "packages/opentui-solid/package.json"), "utf8"))
    const corePackage = JSON.parse(await readFile(path.join(repoRoot, "packages/opentui-core/package.json"), "utf8"))

    expect(solidPackage.exports["./transform"]).toMatchObject({
      types: "./scripts/solid-transform.d.ts",
      import: "./scripts/solid-transform.js",
    })
    expect(Object.keys(corePackage.optionalDependencies ?? {}).sort()).toEqual([
      "@opentui/core-darwin-arm64",
      "@opentui/core-darwin-x64",
      "@opentui/core-linux-arm64",
      "@opentui/core-linux-arm64-musl",
      "@opentui/core-linux-x64",
      "@opentui/core-linux-x64-musl",
      "@opentui/core-win32-arm64",
      "@opentui/core-win32-x64",
    ])

    const { transformSolidSource } = await import("@ax-code/opentui-solid/transform")
    const output = await transformSolidSource("export const View = () => <text>Hello</text>", {
      filename: "/tmp/opentui-view.tsx",
      moduleName: "@ax-code/opentui-solid",
    })

    expect(output).toContain('from "@ax-code/opentui-solid"')
    expect(output).toContain('createElement("text")')
    expect(output).not.toContain("<text>")
  })
})
