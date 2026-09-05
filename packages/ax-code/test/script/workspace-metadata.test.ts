import { describe, expect, test } from "vitest"
import { readFile, realpath } from "fs/promises"
import { existsSync } from "fs"
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

    // Transitional (ADR-074): the framework is consumed from the sibling
    // standalone checkout until it is published to JSR and pinned here.
    const axTuiDep = dependencies["ax-tui"]
    expect(typeof axTuiDep).toBe("string")
    expect(axTuiDep).toMatch(/^link:/)
    const linkTarget = path.resolve(repoRoot, "packages/ax-code", axTuiDep.slice("link:".length))
    expect(existsSync(path.join(linkTarget, "package.json"))).toBe(true)
    expect(dependencies["ax-tui/solid"]).toBeUndefined()
    expect(dependencies["@ax-code/opentui-keymap"]).toBeUndefined()
    expect(dependencies["ax-tui/spinner"]).toBeUndefined()
    expect(dependencies["@ax-code/render"]).toBeUndefined()
    expect(devDependencies["@ax-code/render"]).toBeUndefined()
    expect(tsconfig.compilerOptions?.jsxImportSource).toBe("ax-tui/solid")
  })

  test("Turbo does not cache in-repository TUI framework build output", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const turbo = JSON.parse(await readFile(path.join(repoRoot, "turbo.json"), "utf8"))

    // The ax-tui framework builds in its own repository (ADR-074); this repo
    // must not carry a turbo task for it.
    expect(turbo.tasks?.["ax-tui#build"]).toBeUndefined()
  })

  test("Turbo has no in-repository Desktop build tasks", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    const turbo = JSON.parse(await readFile(path.join(repoRoot, "turbo.json"), "utf8"))

    expect(Object.keys(turbo.tasks ?? {}).filter((name) => /desktop|electron|openchamber/i.test(name))).toEqual([])
  })

  test("AX Code TUI JSX runtime resolves through the workspace package", async () => {
    await expect(import("ax-tui/solid/jsx-runtime")).resolves.toMatchObject({
      jsx: expect.any(Function),
    })
  })

  test("AX Code TUI transform is a stable exported build API", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../../../")
    // The framework package is consumed through the link: dependency
    // (ADR-074); resolve through node_modules to test the real artifact.
    const tuiDir = await realpath(path.join(repoRoot, "packages/ax-code/node_modules/ax-tui"))
    const tuiPackage = JSON.parse(await readFile(path.join(tuiDir, "package.json"), "utf8"))

    expect(tuiPackage.exports["./solid/transform"]).toMatchObject({
      types: "./solid/scripts/solid-transform.d.ts",
      import: "./solid/scripts/solid-transform.js",
    })
    // The native Zig libraries are vendored under vendor/, not resolved from
    // upstream @opentui/core-<platform> optional dependencies.
    expect(tuiPackage.optionalDependencies ?? {}).toEqual({})
    const vendorManifest = JSON.parse(await readFile(path.join(tuiDir, "vendor/manifest.json"), "utf8"))
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

    const { transformSolidSource } = await import("ax-tui/solid/transform")
    const output = await transformSolidSource("export const View = () => <text>Hello</text>", {
      filename: "/tmp/ax-code-tui-view.tsx",
      moduleName: "ax-tui/solid",
    })

    expect(output).toContain('from "ax-tui/solid"')
    expect(output).toContain('createElement("text")')
    expect(output).not.toContain("<text>")
  })
})
