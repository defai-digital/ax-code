import { describe, expect, test } from "vitest"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import path from "node:path"

// Regression guard for the unstoppable TUI crash where OpenTUI's render loop
// spammed `TypeError: Argument N must be a uint32` every frame. OpenTUI's native
// draw symbols declare x/y/width/height as u32, and Node's --experimental-ffi
// marshalling rejects negative or fractional values (Bun silently coerced them,
// so it only regressed after the Bun->Node migration). A LineNumberRenderable
// scrolled above the viewport produces a negative y, and a gutter wider than its
// container a negative width — either threw on every frame.
//
// We fix it by patching @opentui/core (patches/@opentui__core@0.4.1.patch) to
// sanitize geometry at the FFI boundary. The native path needs --experimental-ffi
// (absent in the default suite), so instead of driving real FFI this test loads
// the *actual shipped* guard code from the installed package and executes it
// against the exact crash inputs. If the patch is ever dropped (e.g. an opentui
// bump that doesn't re-apply it), extraction fails and this test goes red —
// before the crash can ship again.

function ffiSource(): string {
  const entry = fileURLToPath(import.meta.resolve("@ax-code/opentui-core"))
  const dir = path.dirname(entry)
  const file = fs
    .readdirSync(dir)
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => path.join(dir, f))
    .find((f) => fs.readFileSync(f, "utf8").includes("bufferFillRect(buffer, x, y, width, height, color)"))
  if (!file) throw new Error("Could not locate the @ax-code/opentui-core FFI render module")
  return fs.readFileSync(file, "utf8")
}

const SRC = ffiSource()

// Methods whose native x/y args are u32 and therefore reject negative/fractional
// cell origins. Each must be guarded by the shared ffiCellOrigin() helper so an
// off-screen origin is dropped instead of crashing the render loop.
const POINT_DRAW_METHODS = [
  "bufferDrawText",
  "bufferSetCell",
  "bufferSetCellWithAlphaBlending",
  "bufferDrawChar",
  "bufferDrawSuperSampleBuffer",
]

// Extract the shared origin guard and run it as real code.
function loadFfiCellOrigin(): (x: number, y: number) => { x: number; y: number } | null {
  const match = SRC.match(/function ffiCellOrigin\(x, y\) \{[\s\S]*?\n\}/)
  if (!match) throw new Error("patch missing: ffiCellOrigin() not found in @opentui/core")
  return new Function(`${match[0]}\nreturn ffiCellOrigin`)() as never
}

// Extract the bufferFillRect sanitization (everything before the FFI call) and
// run it, returning the geometry that would reach the native symbol, or null
// when the call is skipped.
function loadFillRectSanitizer(): (
  x: number,
  y: number,
  width: number,
  height: number,
) => { x: number; y: number; width: number; height: number } | null {
  const match = SRC.match(
    /bufferFillRect\(buffer, x, y, width, height, color\) \{\n([\s\S]*?)\n {4}const bg2 = rgbaPtr\(color\);/,
  )
  if (!match) throw new Error("patch missing: bufferFillRect sanitization not found in @opentui/core")
  const body = `${match[1]}\nreturn { x, y, width, height };`
  const fn = new Function("x", "y", "width", "height", body) as (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => { x: number; y: number; width: number; height: number } | undefined
  return (x, y, width, height) => fn(x, y, width, height) ?? null
}

const isU32 = (n: number) => Number.isInteger(n) && n >= 0 && n < 2 ** 32

describe("OpenTUI FFI coordinate guard (patch regression)", () => {
  test("the patch is present in the installed @opentui/core", () => {
    expect(SRC).toContain("function ffiCellOrigin(x, y)")
    // Every u32 point-draw method routes its origin through the guard.
    for (const method of POINT_DRAW_METHODS) {
      const body = SRC.slice(SRC.indexOf(`${method}(buffer`))
      const guardBeforeCall = body.indexOf("ffiCellOrigin")
      const ffiCall = body.indexOf(`this.opentui.symbols.${method}(`)
      expect(guardBeforeCall, `${method} is not guarded by ffiCellOrigin`).toBeGreaterThanOrEqual(0)
      expect(guardBeforeCall, `${method} guard must run before its FFI call`).toBeLessThan(ffiCall)
    }
  })

  describe("ffiCellOrigin() — point draws (drawText/setCell/drawChar/...)", () => {
    const ffiCellOrigin = loadFfiCellOrigin()

    test("drops a negative origin instead of throwing (the off-screen case)", () => {
      expect(ffiCellOrigin(4, -2)).toBeNull()
      expect(ffiCellOrigin(-1, 0)).toBeNull()
    })

    test("drops a non-finite origin", () => {
      expect(ffiCellOrigin(Number.NaN, 1)).toBeNull()
      expect(ffiCellOrigin(0, Number.POSITIVE_INFINITY)).toBeNull()
    })

    test("floors a fractional origin to a valid u32 cell", () => {
      const o = ffiCellOrigin(3.7, 5.2)
      expect(o).not.toBeNull()
      expect(o).toEqual({ x: 3, y: 5 })
      expect(isU32(o!.x) && isU32(o!.y)).toBe(true)
    })

    test("passes a valid origin through unchanged", () => {
      expect(ffiCellOrigin(0, 0)).toEqual({ x: 0, y: 0 })
      expect(ffiCellOrigin(7, 2)).toEqual({ x: 7, y: 2 })
    })
  })

  describe("bufferFillRect() — the exact reported crash", () => {
    const fillRect = loadFillRectSanitizer()

    test("skips a 1-tall row scrolled to y=-1 (LineNumberRenderable gutter)", () => {
      // This is the precise input that threw "Argument 2 must be a uint32".
      expect(fillRect(2, -1, 5, 1)).toBeNull()
    })

    test("clips a taller rect at negative y to the visible region", () => {
      expect(fillRect(2, -1, 5, 3)).toEqual({ x: 2, y: 0, width: 5, height: 2 })
    })

    test("clips a negative x by shrinking width", () => {
      expect(fillRect(-3, 0, 10, 1)).toEqual({ x: 0, y: 0, width: 7, height: 1 })
    })

    test("skips a negative width (gutter wider than its container)", () => {
      expect(fillRect(0, 3, -4, 1)).toBeNull()
    })

    test("floors fractional geometry to valid u32 args", () => {
      const r = fillRect(1.6, 2.9, 5.4, 1.2)
      expect(r).not.toBeNull()
      expect([r!.x, r!.y, r!.width, r!.height].every(isU32)).toBe(true)
      expect(r).toEqual({ x: 1, y: 2, width: 5, height: 1 })
    })

    test("skips non-finite geometry", () => {
      expect(fillRect(Number.NaN, 0, 5, 1)).toBeNull()
      expect(fillRect(0, Number.POSITIVE_INFINITY, 5, 1)).toBeNull()
    })

    test("passes a fully-visible rect through unchanged", () => {
      expect(fillRect(1, 1, 5, 2)).toEqual({ x: 1, y: 1, width: 5, height: 2 })
    })
  })
})
