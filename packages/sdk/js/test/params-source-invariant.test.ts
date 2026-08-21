import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

// The generated params clients are patched at build time (script/build.ts) so
// every dynamic param write goes through setParamValue, which drops
// prototype-pollution keys. This test pins the patched SOURCE so a regenerated
// or hand-edited tree that loses the guard fails at test time too, not only
// during the next SDK build.
const generatedParamsClients = ["../src/gen/core/params.gen.ts", "../src/v2/gen/core/params.gen.ts"]

const RAW_DYNAMIC_ASSIGNMENT = /\(params\[(field\.in|slot( as Slot)?)\] as Record<string, unknown>\)\[[^\]]+\] = /

describe("generated params client source invariant", () => {
  test.each(generatedParamsClients)("routes dynamic param writes through setParamValue in %s", (file) => {
    const source = readFileSync(path.join(import.meta.dirname, file), "utf8")
    expect(source).toContain("const isUnsafeParamKey = ")
    expect(source).toContain("const setParamValue = ")
    expect(source).not.toMatch(RAW_DYNAMIC_ASSIGNMENT)
  })
})
