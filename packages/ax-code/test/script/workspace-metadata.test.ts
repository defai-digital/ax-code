import { describe, expect, test } from "vitest"
import { readFile } from "fs/promises"
import path from "path"

function extractWorkspaceGlobs(pnpmWorkspaceYaml: string) {
  // Only the `packages:` list is workspace globs. Other list settings
  // (onlyBuiltDependencies, etc.) also use `  - item` lines and must be ignored.
  const packagesBlock = pnpmWorkspaceYaml.match(/^packages:\r?\n((?:[ \t]+- .+\r?\n?)*)/m)?.[1] ?? ""
  return [...packagesBlock.matchAll(/^[ \t]+- (.+)$/gm)].map((match) => match[1].replace(/^(["'])(.*)\1$/, "$2"))
}

describe("script.workspace-metadata", () => {
  test("root package.json workspaces stay aligned with pnpm-workspace.yaml", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
    const pnpmWorkspaceYaml = await readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8")

    expect(packageJson.workspaces).toEqual(extractWorkspaceGlobs(pnpmWorkspaceYaml))
  })

  test("legacy renderer package peer exceptions are absent", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"))
    const allowedVersions = packageJson.pnpm?.peerDependencyRules?.allowedVersions ?? {}
    const legacyRules = Object.fromEntries(
      Object.entries(allowedVersions).filter(([selector]) => selector.includes("@ax-code/opentui")),
    )

    expect(legacyRules).toEqual({})
  })

  test("TUI dependencies use one validated workspace package", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/package.json"), "utf8"))
    const tsconfig = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code/tsconfig.json"), "utf8"))
    const dependencies = packageJson.dependencies ?? {}
    const devDependencies = packageJson.devDependencies ?? {}

    expect(dependencies["@ax-code/tui"]).toBe("workspace:*")
    expect(dependencies["@ax-code/tui/solid"]).toBeUndefined()
    expect(dependencies["@ax-code/opentui-keymap"]).toBeUndefined()
    expect(dependencies["@ax-code/tui/spinner"]).toBeUndefined()
    expect(dependencies["@ax-code/render"]).toBeUndefined()
    expect(devDependencies["@ax-code/render"]).toBeUndefined()
    expect(tsconfig.compilerOptions?.jsxImportSource).toBe("@ax-code/tui/solid")
  })

  test("AX Code TUI JSX runtime resolves through the workspace package", async () => {
    await expect(import("@ax-code/tui/solid/jsx-runtime")).resolves.toMatchObject({
      jsx: expect.any(Function),
    })
  })

  test("AX Code TUI transform is a stable exported build API", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const tuiPackage = JSON.parse(await readFile(path.join(repoRoot, "packages/ax-code-tui/package.json"), "utf8"))

    expect(tuiPackage.exports["./solid/transform"]).toMatchObject({
      types: "./solid/scripts/solid-transform.d.ts",
      import: "./solid/scripts/solid-transform.js",
    })
    // The native Zig libraries are vendored in-repo (packages/ax-code-tui/vendor/),
    // not resolved from upstream @opentui/core-<platform> optional dependencies.
    expect(tuiPackage.optionalDependencies ?? {}).toEqual({})
    const vendorManifest = JSON.parse(
      await readFile(path.join(repoRoot, "packages/ax-code-tui/vendor/manifest.json"), "utf8"),
    )
    expect(Object.keys(vendorManifest.targets ?? {}).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-arm64-musl",
      "linux-x64",
      "linux-x64-musl",
      "win32-arm64",
      "win32-x64",
    ])

    const { transformSolidSource } = await import("@ax-code/tui/solid/transform")
    const output = await transformSolidSource("export const View = () => <text>Hello</text>", {
      filename: "/tmp/ax-code-tui-view.tsx",
      moduleName: "@ax-code/tui/solid",
    })

    expect(output).toContain('from "@ax-code/tui/solid"')
    expect(output).toContain('createElement("text")')
    expect(output).not.toContain("<text>")
  })
})
