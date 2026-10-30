import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { checkTuiPatches, axRuntimeIdentityApplied } from "./tui-patches"
import { AX_TUI_JSX_UNUSED } from "./tui-surface"

describe("owned renderer contracts", () => {
  test("all inherited AX fixes live in the TypeScript source", () => {
    expect(checkTuiPatches().filter((item) => !item.ok)).toEqual([])
  })

  test("legacy runtime identity is rejected while native ABI identifiers remain valid", () => {
    expect(axRuntimeIdentityApplied('name: "OTUI_DEBUG"')).toBe(false)
    expect(axRuntimeIdentityApplied('Symbol.for("opentui.solid.transform")')).toBe(false)
    expect(axRuntimeIdentityApplied('name: "AX_CODE_TUI_DEBUG"')).toBe(true)
    expect(axRuntimeIdentityApplied('const file = "libaxtui.so"')).toBe(true)
  })

  test("the generated Solid catalogue omits unsupported intrinsics", () => {
    for (const name of ["index.js", "index.bun.js", "components.js"]) {
      const source = readFileSync(new URL(`../solid/${name}`, import.meta.url), "utf8")
      for (const tag of AX_TUI_JSX_UNUSED) expect(source, name).not.toContain(`${tag}:`)
    }
  })
})
