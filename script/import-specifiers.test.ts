import { describe, expect, test } from "vitest"
import { extractImportSpecifiers } from "./import-specifiers"

describe("extractImportSpecifiers", () => {
  test("covers ESM, CommonJS, TypeScript import-equals, and dynamic imports", () => {
    const source = [
      'import value from "esm-package"',
      'import "side-effect-package"',
      'export { value } from "re-export-package"',
      'const lazy = import("dynamic-package", { with: { type: "json" } })',
      'const common = require("commonjs-package")',
      'import legacy = require("legacy-package")',
    ].join("\n")

    expect(extractImportSpecifiers(source, "fixture.ts")).toEqual([
      { specifier: "esm-package", line: 1, column: 19 },
      { specifier: "side-effect-package", line: 2, column: 8 },
      { specifier: "re-export-package", line: 3, column: 23 },
      { specifier: "dynamic-package", line: 4, column: 21 },
      { specifier: "commonjs-package", line: 5, column: 24 },
      { specifier: "legacy-package", line: 6, column: 25 },
    ])
  })

  test("ignores comments, ordinary strings, and non-literal loader arguments", () => {
    const source = [
      '// import value from "comment-only"',
      'const example = "require(\\\"string-only\\\")"',
      "const target = getTarget()",
      "void import(target)",
      "require(target)",
    ].join("\n")

    expect(extractImportSpecifiers(source, "fixture.ts")).toEqual([])
  })
})
