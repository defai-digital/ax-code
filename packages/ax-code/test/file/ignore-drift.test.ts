import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { FileIgnore } from "../../src/file/ignore"
import jsPatterns from "../../src/file/ignore-patterns.json"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../../../..")

describe("file ignore pattern drift (BP-07)", () => {
  test("JS FileIgnore exports match ignore-patterns.json", () => {
    expect([...FileIgnore.FOLDER_NAMES].sort()).toEqual([...jsPatterns.folders].sort())
    expect([...FileIgnore.FILE_PATTERNS].sort()).toEqual([...jsPatterns.files].sort())
  })

  test("crates/ax-code-fs/ignore-patterns.json matches packages source of truth", () => {
    const rustCopy = path.join(repoRoot, "crates/ax-code-fs/ignore-patterns.json")
    const packagesCopy = path.join(repoRoot, "packages/ax-code/src/file/ignore-patterns.json")
    const rustJson = JSON.parse(readFileSync(rustCopy, "utf8")) as typeof jsPatterns
    const packagesJson = JSON.parse(readFileSync(packagesCopy, "utf8")) as typeof jsPatterns
    expect(rustJson).toEqual(packagesJson)
    expect(packagesJson).toEqual(jsPatterns)
  })
})
