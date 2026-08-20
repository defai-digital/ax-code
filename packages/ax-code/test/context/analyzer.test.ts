import { describe, expect, test } from "vitest"
import path from "path"
import fs from "fs/promises"
import { analyze, decodeAnalyzerPackageJsonValue, parseAnalyzerPackageJsonText } from "../../src/context/analyzer"
import { tmpdir } from "../fixture/fixture"

describe("context analyzer package JSON decoding", () => {
  test("decodes package JSON values into analyzer fields", () => {
    expect(
      decodeAnalyzerPackageJsonValue({
        name: "app",
        version: "1.2.3",
        type: "module",
        description: "Demo",
        main: "dist/index.js",
        bin: { app: "bin/app.js", broken: 1 },
        scripts: { build: "tsc", invalid: false },
        dependencies: { react: "latest", invalid: 1 },
        devDependencies: { vitest: "latest" },
        exports: { ".": "./dist/index.js" },
        packageManager: "pnpm@10.33.4",
      }),
    ).toEqual({
      name: "app",
      version: "1.2.3",
      type: "module",
      description: "Demo",
      main: "dist/index.js",
      bin: { app: "bin/app.js" },
      scripts: { build: "tsc" },
      dependencies: { react: "latest" },
      devDependencies: { vitest: "latest" },
      exports: { ".": "./dist/index.js" },
      packageManager: "pnpm@10.33.4",
    })
  })

  test("drops malformed package JSON fields instead of preserving casts", () => {
    expect(
      decodeAnalyzerPackageJsonValue({
        name: 1,
        bin: {},
        scripts: [],
        dependencies: null,
        devDependencies: { vitest: true },
        packageManager: false,
      }),
    ).toEqual({})
  })

  test("parses package JSON text before analyzer value decoding", () => {
    expect(parseAnalyzerPackageJsonText(JSON.stringify({ name: "app", scripts: { test: "bun test" } }))).toEqual({
      name: "app",
      scripts: { test: "bun test" },
    })
    expect(() => parseAnalyzerPackageJsonText("{not json")).toThrow(SyntaxError)
  })
})

describe("context analyzer complexity scan", () => {
  test("counts root-level files when no source directory exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "deploy.ts"), "const a = 1\nconst b = 2\n")
    await fs.writeFile(path.join(tmp.path, "backup.js"), "console.log('backup')\n")
    await fs.mkdir(path.join(tmp.path, "scripts"))
    await fs.writeFile(path.join(tmp.path, "scripts", "sync.py"), "print('sync')\n")

    const info = await analyze(tmp.path)

    expect(info.directories.source).toBeUndefined()
    expect(info.complexity?.fileCount).toBe(3)
    expect(info.complexity?.linesOfCode).toBe(4)
  })

  test("root fallback does not scan ignored directories", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "index.ts"), "const a = 1\n")
    await fs.mkdir(path.join(tmp.path, "node_modules", "pkg"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "node_modules", "pkg", "index.js"), "module.exports = {}\n")
    await fs.mkdir(path.join(tmp.path, "dist"))
    await fs.writeFile(path.join(tmp.path, "dist", "bundle.js"), "bundled\n")

    const info = await analyze(tmp.path)

    expect(info.complexity?.fileCount).toBe(1)
    expect(info.complexity?.linesOfCode).toBe(1)
  })

  test("still scans only the detected source directory when one exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"))
    await fs.writeFile(path.join(tmp.path, "src", "main.ts"), "const a = 1\nconst b = 2\n")
    await fs.writeFile(path.join(tmp.path, "tool.ts"), "const c = 3\n")

    const info = await analyze(tmp.path)

    expect(info.directories.source).toBe("src")
    expect(info.complexity?.fileCount).toBe(1)
    expect(info.complexity?.linesOfCode).toBe(2)
  })
})
