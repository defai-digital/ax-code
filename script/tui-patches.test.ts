import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  applyKittyKeyboardOptOut,
  applySlimCatalogue,
  axRuntimeIdentityApplied,
  checkTuiPatches,
  findFfiModule,
  findRendererModule,
  geometryGuardApplied,
  nativeResolverApplied,
  kittyKeyboardOptOutApplied,
  pointerPinApplied,
  slimCatalogueApplied,
  zigParserDropped,
} from "./tui-patches"
import { AX_TUI_JSX_UNUSED } from "./tui-surface"

describe("script.tui-patches", () => {
  test("required patches are applied to the committed vendor tree", () => {
    const results = checkTuiPatches()
    expect(results.filter((item) => !item.ok)).toEqual([])
  })

  test("pointer pin, geometry guard, and native resolver stay reviewable as named contracts", () => {
    const ffi = readFileSync(findFfiModule(), "utf8")
    expect(pointerPinApplied(ffi)).toBe(true)
    expect(geometryGuardApplied(ffi)).toBe(true)
    expect(nativeResolverApplied(ffi)).toBe(true)
    expect(zigParserDropped(ffi)).toBe(true)
  })

  test("apply helpers are idempotent on already-patched source", () => {
    const ffi = readFileSync(findFfiModule(), "utf8")
    const renderer = readFileSync(findRendererModule(), "utf8")
    expect(pointerPinApplied(ffi)).toBe(true)
    expect(geometryGuardApplied(ffi)).toBe(true)
    expect(nativeResolverApplied(ffi)).toBe(true)
    expect(kittyKeyboardOptOutApplied(renderer)).toBe(true)
    expect(applyKittyKeyboardOptOut(renderer)).toBe(renderer)
  })

  test("Kitty keyboard null opt-out is preserved instead of defaulted back on", () => {
    const source = "const kittyConfig = config.useKittyKeyboard ?? {};"
    const next = applyKittyKeyboardOptOut(source)
    expect(kittyKeyboardOptOutApplied(next)).toBe(true)
    expect(next).toContain("config.useKittyKeyboard === undefined")
    expect(next).not.toContain("config.useKittyKeyboard ?? {}")
  })

  test("AX-owned runtime configuration and plugin identities use AX names", () => {
    const sources = [
      readFileSync(join("packages", "ax-code-tui", "index-07zpr2dg.js"), "utf8"),
      readFileSync(join("packages", "ax-code-tui", "index-pcvh9d34.js"), "utf8"),
      readFileSync(join("packages", "ax-code-tui", "runtime-plugin.js"), "utf8"),
      readFileSync(join("packages", "ax-code-tui", "solid", "scripts", "solid-plugin.js"), "utf8"),
    ]
    expect(sources.every(axRuntimeIdentityApplied)).toBe(true)
  })

  test("slim-catalogue apply does not strip SelectRenderableEvents or reconciler aliases", () => {
    const source = `import {
  ASCIIFontRenderable,
  BoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable
} from "@ax-code/tui";
import { SelectRenderable as SelectRenderable2 } from "@ax-code/tui";
var baseComponents = {
  box: BoxRenderable,
  text: TextRenderable,
  select: SelectRenderable,
  ascii_font: ASCIIFontRenderable,
  tab_select: TabSelectRenderable,
};
if (node instanceof SelectRenderable2) {
  event = SelectRenderableEvents.SELECTION_CHANGED;
}
`
    const next = applySlimCatalogue(source)
    expect(slimCatalogueApplied(next)).toBe(true)
    expect(next).not.toContain("ascii_font:")
    expect(next).not.toContain("ASCIIFontRenderable")
    expect(next).toContain("SelectRenderableEvents")
    expect(next).toContain("TabSelectRenderableEvents")
    expect(next).toContain("SelectRenderable as SelectRenderable2")
    expect(next).toContain("SelectRenderable2")
  })

  test("Solid catalogue does not register unused TUI widgets", () => {
    for (const name of ["index.js", "index.bun.js", "components.js"]) {
      const source = readFileSync(join("packages", "ax-code-tui", "solid", name), "utf8")
      expect(slimCatalogueApplied(source), name).toBe(true)
      for (const tag of AX_TUI_JSX_UNUSED) {
        expect(source, `${name} still mentions ${tag}`).not.toContain(`${tag}:`)
      }
    }
  })
})
