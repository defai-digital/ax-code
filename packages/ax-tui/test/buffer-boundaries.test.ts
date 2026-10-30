import { describe, expect, test, vi } from "vitest"
vi.mock("../src/core/zig.js", () => ({ resolveRenderLib: vi.fn() }))
vi.mock("../src/platform/ffi.js", () => ({
  ptr: () => 1,
  toPointer: (p: unknown) => p,
  toArrayBuffer: vi.fn(),
}))
import { OptimizedBuffer } from "../src/core/buffer.js"
import { RGBA } from "../src/lib/rgba.js"

function buffer() {
  const native = {
    bufferResize: vi.fn(),
    bufferDrawGrayscaleBuffer: vi.fn(),
    bufferDrawGrayscaleBufferSupersampled: vi.fn(),
    bufferDrawBox: vi.fn(),
    bufferColorMatrix: vi.fn(),
    bufferGetRealCharSize: () => 8,
    bufferWriteResolvedChars: vi.fn((_ptr: unknown, output: Uint8Array) => {
      output.fill(65)
      return output.length
    }),
  }
  return {
    value: new OptimizedBuffer(native as never, 1 as never, 2, 1, {}),
    native,
  }
}

describe("native drawing boundaries", () => {
  test.each([NaN, Infinity, -1, 1.5, 2 ** 32])("rejects invalid resize %s before calling native code", (width) => {
    const { value, native } = buffer()
    expect(() => value.resize(width, 1)).toThrow(RangeError)
    expect(native.bufferResize).not.toHaveBeenCalled()
    expect(value.width).toBe(2)
  })

  test.each(["drawGrayscaleBuffer", "drawGrayscaleBufferSupersampled"] as const)(
    "%s rejects undersized source storage",
    (method) => {
      const { value, native } = buffer()
      expect(() => value[method](0, 0, new Float32Array(3), 2, 2)).toThrow(/intensities/)
      expect(native.bufferDrawGrayscaleBuffer).not.toHaveBeenCalled()
      expect(native.bufferDrawGrayscaleBufferSupersampled).not.toHaveBeenCalled()
    },
  )

  test("rejects truncated border character arrays", () => {
    const { value, native } = buffer()
    expect(() =>
      value.drawBox({
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        border: true,
        borderColor: RGBA.fromHex("#fff"),
        backgroundColor: RGBA.fromHex("#000"),
        customBorderChars: new Uint32Array(1),
      }),
    ).toThrow(/border/i)
    expect(native.bufferDrawBox).not.toHaveBeenCalled()
  })

  test("failed resize preserves dimensions", () => {
    const { value, native } = buffer()
    native.bufferResize.mockImplementation(() => {
      throw new Error("allocation failed")
    })
    expect(() => value.resize(3, 4)).toThrow("allocation failed")
    expect([value.width, value.height]).toEqual([2, 1])
  })

  test("reserves additional bytes for requested line breaks", () => {
    const { value } = buffer()
    expect(value.getRealCharBytes(true).length).toBe(9)
  })
})

test("color matrices reject invalid channels and partial mask triples", () => {
  const { value, native } = buffer()
  const matrix = new Float32Array(16)
  expect(() => value.colorMatrix(matrix, new Float32Array(3), 1, 255)).toThrow(/target/)
  expect(() => value.colorMatrixUniform(matrix, 1, 255)).toThrow(/target/)
  expect(() => value.colorMatrix(matrix, new Float32Array(2))).toThrow(/triples/)
  value.colorMatrix(matrix, new Float32Array(0))
  expect(native.bufferColorMatrix).not.toHaveBeenCalled()
})
