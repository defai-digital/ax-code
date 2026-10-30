import { crc32, deflateSync } from "node:zlib"
import { expect, test } from "vitest"
import { copyRgbaImage, decodePng, MAX_PNG_BYTES } from "../src/lib/image.js"

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type), data])
  const size = Buffer.alloc(4), crc = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([size, body, crc])
}

function png(width: number, height: number, color: number, rows: number[], extra: Buffer[] = [], depth = 8): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = depth
  header[9] = color
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...extra,
    chunk("IDAT", deflateSync(Uint8Array.from(rows))), chunk("IEND", new Uint8Array())])
}

test.each([
  [0, [0, 51], [51, 51, 51, 255]],
  [2, [0, 10, 20, 30], [10, 20, 30, 255]],
  [4, [0, 51, 127], [51, 51, 51, 127]],
  [6, [0, 10, 20, 30, 127], [10, 20, 30, 127]],
])("PNG color type %i decodes exact RGBA pixels", (color, rows, expected) => {
  const image = decodePng(png(1, 1, color as number, rows as number[]))
  expect([image.width, image.height]).toEqual([1, 1])
  expect([...image.data]).toEqual(expected)
})

test("PNG indexed palettes and transparency preserve colors and alpha", () => {
  const image = decodePng(png(2, 1, 3, [0, 1, 0], [
    chunk("PLTE", Uint8Array.from([255, 0, 0, 0, 255, 0])), chunk("tRNS", Uint8Array.from([0, 127])),
  ]))
  expect([...image.data]).toEqual([0, 255, 0, 127, 255, 0, 0, 0])
  expect([...decodePng(png(1, 1, 0, [0, 42], [chunk("tRNS", Uint8Array.from([0, 42]))])).data])
    .toEqual([42, 42, 42, 0])
  expect([...decodePng(png(1, 1, 2, [0, 10, 20, 30], [chunk("tRNS", Uint8Array.from([0, 10, 0, 20, 0, 30]))])).data])
    .toEqual([10, 20, 30, 0])
})

test.each([
  [0, [40, 60, 90]],
  [1, [40, 20, 30]],
  [2, [30, 40, 60]],
  [3, [35, 30, 45]],
  [4, [30, 20, 30]],
])("PNG filter %i reconstructs rows using previously decoded bytes", (filter, encoded) => {
  const image = decodePng(png(3, 2, 0, [0, 10, 20, 30, filter as number, ...(encoded as number[])]))
  expect([...image.data].filter((_value, index) => index % 4 === 0)).toEqual([10, 20, 30, 40, 60, 90])
})

test("PNG budgets reject dimensions, encoded size, excess inflate output and unsupported depths", () => {
  expect(() => decodePng(png(0xffffffff, 2, 6, [0]))).toThrow(/pixel budget/)
  expect(() => decodePng(new Uint8Array(MAX_PNG_BYTES + 1))).toThrow(/byte budget/)
  expect(() => decodePng(png(1, 1, 6, Array(100_000).fill(0)))).toThrow()
  expect(() => decodePng(png(1, 1, 6, [0, 1], [], 16))).toThrow(/8-bit/)
  expect(() => decodePng(png(1, 1, 6, [0, 1, 2, 3]))).toThrow(/decoded size/)
})

test("PNG rejects corrupt, truncated, malformed and incomplete images", () => {
  const valid = png(1, 1, 6, [0, 1, 2, 3, 255])
  const corrupt = Buffer.from(valid)
  corrupt[29] ^= 1
  expect(() => decodePng(corrupt)).toThrow(/CRC/)
  expect(() => decodePng(valid.subarray(0, valid.length - 2))).toThrow(/Truncated/)
  expect(() => decodePng(Buffer.concat([valid, Buffer.from([0])]))).toThrow(/end chunk/)
  expect(() => decodePng(png(1, 1, 6, [5, 1, 2, 3, 255]))).toThrow(/row filter/)
  expect(() => decodePng(png(1, 1, 3, [0, 1], [chunk("PLTE", Uint8Array.from([1, 2, 3]))])))
    .toThrow(/palette index/)
  expect(() => decodePng(png(1, 1, 6, [0, 1, 2, 3, 255], [chunk("FAKE", new Uint8Array())])))
    .toThrow(/critical PNG chunk/)
})

test("RGBA validation snapshots caller pixels and rejects inconsistent dimensions", () => {
  const data = Uint8Array.from([1, 2, 3, 255])
  const image = copyRgbaImage({ width: 1, height: 1, data })
  data[0] = 99
  expect(image.data[0]).toBe(1)
  expect(() => copyRgbaImage({ width: 1.5, height: 1, data })).toThrow()
  expect(() => copyRgbaImage({ width: 2, height: 1, data })).toThrow(/four bytes/)
})
