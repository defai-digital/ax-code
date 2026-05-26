import { describe, expect, test } from "bun:test"
import {
  decodePackageJsonObject,
  packageJsonObjectKeys,
  packageJsonStringMap,
  parsePackageJsonObject,
} from "../../src/util/package-json"

describe("util.package-json", () => {
  test("decodes already-parsed package JSON objects", () => {
    expect(decodePackageJsonObject({ name: "ax-code" })).toEqual({ name: "ax-code" })
    expect(decodePackageJsonObject(null)).toEqual({})
    expect(decodePackageJsonObject([])).toEqual({})
  })

  test("parses package JSON text before value decoding", () => {
    expect(parsePackageJsonObject(JSON.stringify({ scripts: { test: "bun test" } }))).toEqual({
      scripts: { test: "bun test" },
    })
    expect(() => parsePackageJsonObject("{not json")).toThrow(SyntaxError)
  })

  test("extracts package JSON string maps and object keys defensively", () => {
    expect(packageJsonStringMap({ test: "bun test", build: 1 })).toEqual({ test: "bun test" })
    expect(packageJsonStringMap(null)).toEqual({})
    expect(packageJsonObjectKeys({ dependencies: {}, devDependencies: {} })).toEqual([
      "dependencies",
      "devDependencies",
    ])
    expect(packageJsonObjectKeys("not an object")).toEqual([])
  })
})
