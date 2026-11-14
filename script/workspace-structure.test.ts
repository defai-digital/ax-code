import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { parse } from "yaml"
import {
  discoverWorkspacePackages,
  workspaceBoundaryViolations,
  workspaceConfigurationProblems,
  workspaceDependencyCycles,
  workspaceSourceFiles,
  type WorkspacePackage,
} from "./workspace-structure"

const directories: string[] = []

describe("repository workspace policy", () => {
  const root = path.resolve(import.meta.dirname, "..")

  test("keeps the architecture map complete as workspace packages are added", () => {
    const map = readFileSync(path.join(root, "ARCHITECTURE.md"), "utf8")
    for (const pkg of discoverWorkspacePackages(root)) expect(map).toContain(`\`${pkg.dir}\``)
  })

  test("keeps dependency policy in YAML and the lockfile aligned with it", () => {
    const config = parse(readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8")) as {
      overrides: Record<string, string>
      patchedDependencies: Record<string, string>
    }
    const lock = parse(readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8")) as {
      overrides: Record<string, string>
      patchedDependencies: Record<string, { path: string }>
    }
    expect(workspaceConfigurationProblems(root)).toEqual([])
    expect(lock.overrides).toEqual(config.overrides)
    expect(
      Object.fromEntries(Object.entries(lock.patchedDependencies).map(([name, patch]) => [name, patch.path])),
    ).toEqual(config.patchedDependencies)
  })
})

function fixture(patterns = '["packages/*", "packages/sdk/js"]'): {
  root: string
  write(file: string, content: string): void
  pkg(dir: string, name: string, dependencies?: Record<string, string>): void
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "ax-workspace-structure-"))
  directories.push(root)
  function write(file: string, content: string): void {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), content)
  }
  write("pnpm-workspace.yaml", `packages: ${patterns}\n`)
  return {
    root,
    write,
    pkg(dir, name, dependencies = {}) {
      write(`${dir}/package.json`, JSON.stringify({ name, dependencies }))
    },
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("workspace discovery", () => {
  test("rejects a second dependency policy even when it currently matches the YAML policy", () => {
    const f = fixture()
    f.write("package.json", '{"pnpm":{"overrides":{"example":"1"},"patchedDependencies":{}}}')
    expect(workspaceConfigurationProblems(f.root)).toEqual([
      "package.json pnpm.overrides belongs in pnpm-workspace.yaml",
      "package.json pnpm.patchedDependencies belongs in pnpm-workspace.yaml",
    ])
    f.write("package.json", "{}")
    expect(workspaceConfigurationProblems(f.root)).toEqual([])
  })
  test("uses YAML globs, nested SDK packages, exclusions and overlapping patterns", () => {
    const f = fixture('["packages/*", "packages/sdk/js", "packages/viewer", "!packages/excluded"]')
    f.pkg("packages/viewer", "viewer")
    f.pkg("packages/sdk/js", "sdk")
    f.pkg("packages/excluded", "excluded")
    f.pkg("packages/viewer/node_modules/other", "other")
    expect(discoverWorkspacePackages(f.root).map((pkg) => pkg.name)).toEqual(["sdk", "viewer"])
  })

  test("rejects duplicate identities rather than silently losing graph nodes", () => {
    const f = fixture()
    f.pkg("packages/a", "duplicate")
    f.pkg("packages/b", "duplicate")
    expect(() => discoverWorkspacePackages(f.root)).toThrow("Duplicate workspace package name")
  })

  test("rejects invalid workspace configuration and manifest dependency data", () => {
    const f = fixture("[42]")
    expect(() => discoverWorkspacePackages(f.root)).toThrow("packages list")
    f.write("pnpm-workspace.yaml", "packages: ['packages/*']\n")
    f.write("packages/a/package.json", '{"name":"a","dependencies":{"b":42}}')
    expect(() => discoverWorkspacePackages(f.root)).toThrow("Invalid dependency b")
  })
})

describe("workspace boundaries", () => {
  test("catches source and test escapes in newly discovered packages", () => {
    const f = fixture()
    f.pkg("packages/viewer", "@ax-code/viewer", { "@ax-code/core": "workspace:*" })
    f.pkg("packages/core", "@ax-code/core")
    f.write("packages/viewer/src/index.ts", 'export { hidden } from "../../core/src/hidden"\n')
    f.write("packages/viewer/test/core.test.ts", 'import "@ax-code/core/src/hidden"\n')
    f.write("packages/viewer/test/dynamic.test.mjs", 'await import("../../core/test/helper.js")\n')
    f.write("packages/viewer/src/safe.ts", 'import "@ax-code/core"\nimport "./helper"\n')
    const violations = workspaceBoundaryViolations(f.root, discoverWorkspacePackages(f.root))
    expect(violations).toEqual([
      { file: "packages/viewer/src/index.ts", spec: "../../core/src/hidden" },
      { file: "packages/viewer/test/core.test.ts", spec: "@ax-code/core/src/hidden" },
      { file: "packages/viewer/test/dynamic.test.mjs", spec: "../../core/test/helper.js" },
    ])
  })

  test("checks nested SDK tests against their own package root", () => {
    const f = fixture()
    f.pkg("packages/sdk/js", "sdk")
    f.write("packages/sdk/js/test/contracts.test.ts", 'import "../src/index"\nimport "../../other/src/index"\n')
    expect(workspaceBoundaryViolations(f.root, discoverWorkspacePackages(f.root))).toEqual([
      { file: "packages/sdk/js/test/contracts.test.ts", spec: "../../other/src/index" },
    ])
  })

  test("checks root runtime modules and nested authored trees, excluding tooling and vendor data", () => {
    const f = fixture()
    f.pkg("packages/framework", "framework")
    for (const file of [
      "index.ts",
      "solid/source/index.tsx",
      "native/source/index.mts",
      "chart/src/index.ts",
      "src/perf/index.ts",
      "test/script/check.test.ts",
    ]) {
      f.write(`packages/framework/${file}`, "export {}\n")
    }
    for (const file of [
      "vendor/src/index.ts",
      "dist/index.js",
      "node_modules/a/src/index.ts",
      "script/build.ts",
      "perf/fixture/src/index.ts",
      "vitest.config.ts",
      "index.d.ts",
    ]) {
      f.write(`packages/framework/${file}`, 'import "../../outside/src/index"\n')
    }
    const packages = discoverWorkspacePackages(f.root)
    expect(workspaceSourceFiles(f.root, packages[0]!)).toEqual([
      "packages/framework/chart/src/index.ts",
      "packages/framework/index.ts",
      "packages/framework/native/source/index.mts",
      "packages/framework/solid/source/index.tsx",
      "packages/framework/src/perf/index.ts",
      "packages/framework/test/script/check.test.ts",
    ])
    expect(workspaceBoundaryViolations(f.root, packages)).toEqual([])
  })

  test("uses the renderer receipt to exclude generated AX TUI modules while checking source", () => {
    const f = fixture()
    f.pkg("packages/framework", "@defai-digital/ax-tui")
    f.write("packages/framework/renderer-artifacts.json", '{"files":["index.js","solid/src/index.js"]}')
    f.write("packages/framework/index.js", 'import "../other/src/index"\n')
    f.write("packages/framework/solid/src/index.js", 'import "../../../other/src/index"\n')
    f.write("packages/framework/solid/source/index.ts", 'import "../../../other/src/index"\n')
    expect(workspaceBoundaryViolations(f.root, discoverWorkspacePackages(f.root))).toEqual([
      { file: "packages/framework/solid/source/index.ts", spec: "../../../other/src/index" },
    ])
  })
})

describe("workspace cycles", () => {
  function pkg(name: string, dependencies: Record<string, string> = {}): WorkspacePackage {
    return { name, dir: `packages/${name}`, manifest: `packages/${name}/package.json`, dependencies }
  }

  test("detects and deduplicates cycles through scoped and unscoped workspace aliases", () => {
    const packages = [
      pkg("app", { renderer: "workspace:@defai-digital/ax-tui@*" }),
      pkg("@defai-digital/ax-tui", { helper: "workspace:shared@^1" }),
      pkg("shared", { app: "workspace:*" }),
    ]
    expect(workspaceDependencyCycles(packages)).toEqual([
      "@defai-digital/ax-tui -> shared -> app -> @defai-digital/ax-tui",
    ])
  })

  test("accepts acyclic shared dependencies and ignores external packages", () => {
    expect(
      workspaceDependencyCycles([
        pkg("app", { util: "workspace:*", sdk: "workspace:*", external: "1" }),
        pkg("sdk", { util: "workspace:*" }),
        pkg("util"),
      ]),
    ).toEqual([])
  })

  test("detects self-dependencies", () => {
    expect(workspaceDependencyCycles([pkg("app", { app: "workspace:*" })])).toEqual(["app -> app"])
  })
})
