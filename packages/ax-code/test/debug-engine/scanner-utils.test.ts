import { describe, expect, test } from "vitest"
import { writeFile, mkdir } from "node:fs/promises"
import path from "path"
import {
  collectScannerFileBatch,
  collectScannerFiles,
  isTestFile,
  resolveScannerDefaults,
  resolveScannerFile,
  scannerFileBatchHeuristics,
  scannerUsesIncrementalFiles,
  scanScannerFiles,
  sortScannerFindings,
} from "../../src/debug-engine/scanner-utils"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("debug-engine scanner utils", () => {
  test("detects test files and test directories", () => {
    expect(isTestFile("src/foo.test.ts")).toBe(true)
    expect(isTestFile("src/foo.test.mjs")).toBe(true)
    expect(isTestFile("src/foo.spec.cjs")).toBe(true)
    expect(isTestFile("test/foo.ts")).toBe(true)
    expect(isTestFile("src/__mocks__/foo.ts")).toBe(true)
    expect(isTestFile("src\\__mocks__\\foo.ts")).toBe(true)
    expect(isTestFile("tests\\foo.ts")).toBe(true)
    expect(isTestFile("src/foo.ts")).toBe(false)
  })

  test("resolves shared scanner defaults", () => {
    expect(resolveScannerDefaults({})).toMatchObject({
      excludeTests: true,
      maxFiles: 500,
      maxPerFile: 20,
    })

    expect(
      resolveScannerDefaults({
        excludeTests: false,
        maxFiles: 3,
        maxFindingsPerFile: 4,
        include: ["src/**/*.ts"],
      }),
    ).toEqual({
      excludeTests: false,
      maxFiles: 3,
      maxPerFile: 4,
      include: ["src/**/*.ts"],
    })
  })

  test("resolves scanner files without corrupting absolute paths", () => {
    expect(resolveScannerFile("src/app.ts", "/repo")).toBe(path.join("/repo", "src", "app.ts"))
    expect(resolveScannerFile("/tmp/app.ts", "/repo")).toBe("/tmp/app.ts")
  })

  test("treats any explicit file list as incremental", () => {
    expect(scannerUsesIncrementalFiles({})).toBe(false)
    expect(scannerUsesIncrementalFiles({ files: [] })).toBe(true)
    expect(scannerUsesIncrementalFiles({ files: ["src/app.ts"] })).toBe(true)
  })

  test("does not expand an explicit empty file list into a full scan", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "src"), { recursive: true })
        await writeFile(path.join(dir, "src", "app.ts"), "export const app = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          await collectScannerFiles({ files: [] }, { cwd: tmp.path, include: ["**/*.ts"], excludeTests: true }),
        ).toEqual({
          incremental: true,
          files: [],
        })
      },
    })
  })

  test("collects unique worktree files from incremental input", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = path.join(tmp.path, "src", "app.ts")
    const testFile = path.join(tmp.path, "src", "app.test.ts")
    const dependency = path.join(tmp.path, "node_modules", "pkg", "index.ts")
    const generated = path.join(tmp.path, "dist", "app.ts")
    const outside = path.join(path.dirname(tmp.path), "outside.ts")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          await collectScannerFiles(
            { files: [app, app, testFile, dependency, generated, outside] },
            { cwd: tmp.path, include: ["**/*.ts"], excludeTests: true },
          ),
        ).toEqual({
          incremental: true,
          files: [app],
        })
      },
    })
  })

  test("resolves relative incremental input against the scanner cwd", async () => {
    await using tmp = await tmpdir({ git: true })
    const app = path.join(tmp.path, "src", "app.ts")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          await collectScannerFiles(
            { files: ["src/app.ts", "../outside.ts"] },
            { cwd: tmp.path, include: ["**/*.ts"], excludeTests: true },
          ),
        ).toEqual({
          incremental: true,
          files: [app],
        })
      },
    })
  })

  test("excludes generated and dependency directories during glob collection", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await mkdir(path.join(dir, "src"), { recursive: true })
        await writeFile(path.join(dir, "src", "app.ts"), "export const app = true\n")
        await mkdir(path.join(dir, "node_modules", "pkg"), { recursive: true })
        await writeFile(path.join(dir, "node_modules", "pkg", "index.ts"), "export const dependency = true\n")
        await mkdir(path.join(dir, "src", ".next"), { recursive: true })
        await writeFile(path.join(dir, "src", ".next", "server.ts"), "export const generated = true\n")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(await collectScannerFiles({}, { cwd: tmp.path, include: ["**/*.ts"], excludeTests: true })).toEqual({
          incremental: false,
          files: [path.join(tmp.path, "src", "app.ts")],
        })
      },
    })
  })

  test("collects capped scanner file batches with candidate metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    const first = path.join(tmp.path, "src", "first.ts")
    const second = path.join(tmp.path, "src", "second.ts")
    const third = path.join(tmp.path, "src", "third.ts")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(
          await collectScannerFileBatch(
            { files: [first, second, first, third] },
            { cwd: tmp.path, include: ["**/*.ts"], excludeTests: true, maxFiles: 2 },
          ),
        ).toEqual({
          files: [first, second],
          candidateFileCount: 3,
          incremental: true,
          truncated: true,
        })
      },
    })
  })

  test("builds scanner file batch heuristics", () => {
    expect(
      scannerFileBatchHeuristics({
        files: ["a.ts", "b.ts"],
        candidateFileCount: 3,
        incremental: true,
        truncated: true,
      }),
    ).toEqual(["incremental", "candidate-files=3", "file-cap-hit"])

    expect(
      scannerFileBatchHeuristics({
        files: ["a.ts"],
        candidateFileCount: 1,
        incremental: false,
        truncated: false,
      }),
    ).toEqual(["candidate-files=1"])
  })

  test("sorts scanner findings by severity, file, and line", () => {
    const findings = [
      { severity: "low" as const, file: "b.ts", line: 1, id: "low-b" },
      { severity: "high" as const, file: "b.ts", line: 3, id: "high-b3" },
      { severity: "high" as const, file: "a.ts", line: 9, id: "high-a9" },
      { severity: "medium" as const, file: "a.ts", line: 1, id: "medium-a" },
      { severity: "high" as const, file: "b.ts", line: 1, id: "high-b1" },
    ]

    expect(sortScannerFindings(findings).map((finding) => finding.id)).toEqual([
      "high-a9",
      "high-b1",
      "high-b3",
      "medium-a",
      "low-b",
    ])
    expect(findings[0].id).toBe("high-a9")
  })

  test("scans files through JS fallback when native batch read is unavailable", async () => {
    const scanned: Array<{ file: string; content?: string }> = []
    const result = await scanScannerFiles(
      ["a.ts", "b.ts"],
      async (file, content) => {
        scanned.push({ file, content })
        return [`finding:${file}`]
      },
      { readFilesBatch: () => undefined },
    )

    expect(result).toEqual({
      findings: ["finding:a.ts", "finding:b.ts"],
      usedNativeBatchRead: false,
    })
    expect(scanned).toEqual([
      { file: "a.ts", content: undefined },
      { file: "b.ts", content: undefined },
    ])
  })

  test("scans preread native content and skips unreadable files", async () => {
    const scanned: Array<{ file: string; content?: string }> = []
    const result = await scanScannerFiles(
      ["a.ts", "empty.ts", "missing.ts", "b.ts"],
      async (file, content) => {
        scanned.push({ file, content })
        return [`finding:${content}`]
      },
      {
        readFilesBatch: () =>
          new Map([
            ["a.ts", "alpha"],
            ["empty.ts", ""],
            ["b.ts", "bravo"],
          ]),
      },
    )

    expect(result).toEqual({
      findings: ["finding:alpha", "finding:", "finding:bravo"],
      usedNativeBatchRead: true,
    })
    expect(scanned).toEqual([
      { file: "a.ts", content: "alpha" },
      { file: "empty.ts", content: "" },
      { file: "b.ts", content: "bravo" },
    ])
  })
})
