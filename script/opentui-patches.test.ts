import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  applySlimCatalogue,
  checkOpentuiPatches,
  findFfiModule,
  geometryGuardApplied,
  nativeResolverApplied,
  pointerPinApplied,
  slimCatalogueApplied,
  zigParserDropped,
} from "./opentui-patches"
import { TUI_OPENTUI_JSX_UNUSED } from "./opentui-surface"

describe("script.opentui-patches", () => {
  test("required patches are applied to the committed vendor tree", () => {
    const results = checkOpentuiPatches()
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
    expect(pointerPinApplied(ffi)).toBe(true)
    expect(geometryGuardApplied(ffi)).toBe(true)
    expect(nativeResolverApplied(ffi)).toBe(true)
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
} from "@ax-code/opentui-core";
import { SelectRenderable as SelectRenderable2 } from "@ax-code/opentui-core";
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
      const source = readFileSync(join("packages", "opentui-solid", name), "utf8")
      expect(slimCatalogueApplied(source), name).toBe(true)
      for (const tag of TUI_OPENTUI_JSX_UNUSED) {
        expect(source, `${name} still mentions ${tag}`).not.toContain(`${tag}:`)
      }
    }
  })
})
