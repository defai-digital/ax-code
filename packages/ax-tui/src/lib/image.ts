import { inflateSync } from "node:zlib"

export interface RgbaImage {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
}

export const MAX_IMAGE_PIXELS = 4_194_304
export const MAX_PNG_BYTES = 16 * 1024 * 1024

export function validateImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
    width * height > MAX_IMAGE_PIXELS) throw new RangeError("Image dimensions exceed the 4194304 pixel budget")
}

/** Copy caller-owned pixels so later mutation cannot change a cached image or its upload. */
export function copyRgbaImage(image: RgbaImage): RgbaImage {
  validateImageDimensions(image.width, image.height)
  if (!(image.data instanceof Uint8Array) || image.data.byteLength !== image.width * image.height * 4) {
    throw new RangeError("RGBA image data must contain exactly four bytes per pixel")
  }
  return Object.freeze({ width: image.width, height: image.height, data: new Uint8Array(image.data) })
}

const signature = [137, 80, 78, 71, 13, 10, 26, 10]
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function paeth(left: number, above: number, corner: number): number {
  const prediction = left + above - corner
  const a = Math.abs(prediction - left), b = Math.abs(prediction - above), c = Math.abs(prediction - corner)
  return a <= b && a <= c ? left : b <= c ? above : corner
}

/** Bounded, noninterlaced 8-bit PNG decoder. Unsupported sample depths fail explicitly. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (bytes.byteLength > MAX_PNG_BYTES) throw new RangeError("PNG exceeds the 16 MiB encoded byte budget")
  if (bytes.length < 33 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error("Invalid PNG signature")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0, color = -1, channels = 0
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const chunks: Uint8Array[] = []
  let compressedLength = 0
  let sawData = false, dataEnded = false, ended = false
  let offset = 8
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk")
    const length = view.getUint32(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error("Truncated PNG chunk data")
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (!/^[A-Za-z]{4}$/.test(type) || (bytes[offset + 6]! & 32)) throw new Error("Invalid PNG chunk type")
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error("Invalid PNG chunk CRC")
    const data = bytes.subarray(offset + 8, end - 4)
    if (offset === 8 && type !== "IHDR") throw new Error("PNG header must be first")
    if (sawData && type !== "IDAT") dataEnded = true
    switch (type) {
      case "IHDR": {
        if (width || length !== 13) throw new Error("Invalid or repeated PNG header")
        width = view.getUint32(offset + 8)
        height = view.getUint32(offset + 12)
        validateImageDimensions(width, height)
        color = data[9]!
        channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color] ?? 0
        if (data[8] !== 8 || !channels || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
          throw new Error("Only noninterlaced 8-bit PNG images are supported")
        }
        break
      }
      case "PLTE":
        if (palette || sawData || color === 0 || color === 4 || !length || length > 768 || length % 3) {
          throw new Error("Invalid PNG palette")
        }
        palette = data
        break
      case "tRNS":
        if (transparency || sawData || (color === 0 ? length !== 2 : color === 2 ? length !== 6 :
          color === 3 ? !palette || !length || length > palette.length / 3 : true)) throw new Error("Invalid PNG transparency")
        transparency = data
        break
      case "IDAT":
        if (dataEnded || (color === 3 && !palette)) throw new Error("Invalid PNG image data order")
        if (chunks.length >= 4096) throw new Error("PNG exceeds the image data chunk budget")
        sawData = true
        compressedLength += length
        chunks.push(data)
        break
      case "IEND":
        if (length || !sawData || end !== bytes.length) throw new Error("Invalid PNG end chunk")
        ended = true
        break
      default:
        if (!(bytes[offset + 4]! & 32)) throw new Error(`Unsupported critical PNG chunk: ${type}`)
    }
    offset = end
    if (ended) break
  }
  if (!ended || !compressedLength) throw new Error("Incomplete PNG image")
  const compressed = new Uint8Array(compressedLength)
  let cursor = 0
  for (const chunk of chunks) {
    compressed.set(chunk, cursor)
    cursor += chunk.length
  }
  const stride = width * channels
  const expectedLength = (stride + 1) * height
  const inflated = inflateSync(compressed, { maxOutputLength: expectedLength })
  if (inflated.length !== expectedLength) throw new Error("Invalid PNG decoded size")
  const pixels = new Uint8Array(width * height * 4)
  const transparent = transparency ? new DataView(transparency.buffer, transparency.byteOffset, transparency.length) : null
  let previous = new Uint8Array(stride)
  let row = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1)
    const filter = inflated[start]!
    if (filter > 4) throw new Error("Invalid PNG row filter")
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels]! : 0
      const above = previous[x]!, corner = x >= channels ? previous[x - channels]! : 0
      const prediction = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above :
        filter === 3 ? Math.floor((left + above) / 2) : paeth(left, above, corner)
      row[x] = (inflated[start + 1 + x]! + prediction) & 255
    }
    for (let x = 0; x < width; x++) {
      const source = x * channels, dest = (y * width + x) * 4
      const red = row[source]!, green = row[source + 1]!, blue = row[source + 2]!
      if (color === 3) {
        if (!palette || red * 3 + 2 >= palette.length) throw new Error("PNG palette index out of range")
        pixels[dest] = palette[red * 3]!
        pixels[dest + 1] = palette[red * 3 + 1]!
        pixels[dest + 2] = palette[red * 3 + 2]!
        pixels[dest + 3] = transparency?.[red] ?? 255
      } else {
        pixels[dest] = red
        pixels[dest + 1] = color === 0 || color === 4 ? red : green
        pixels[dest + 2] = color === 0 || color === 4 ? red : blue
        let alpha = color === 4 ? green : color === 6 ? row[source + 3]! : 255
        if (transparent) {
          if (color === 0 ? red === transparent.getUint16(0) :
            red === transparent.getUint16(0) && green === transparent.getUint16(2) && blue === transparent.getUint16(4)) {
            alpha = 0
          }
        }
        pixels[dest + 3] = alpha
      }
    }
    const scratch = previous
    previous = row
    row = scratch
  }
  return Object.freeze({ width, height, data: pixels })
}
