import { describe, expect, test } from "vitest"
import {
  imagePreviewLabel,
  imagePreviewSource,
  IMAGE_PREVIEW_MAX_BYTES,
} from "../../../src/cli/tui/ui/image-preview-source"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEElEQVR4nGNgCPj/H4xhDABLsgk56rbLVwAAAABJRU5ErkJggg=="
const file = (url = `data:image/png;base64,${png}`, mime = "image/png") => ({ mime, url })

describe("image preview input boundary", () => {
  test("accepts session-carried PNG bytes", () => {
    expect(Buffer.from(imagePreviewSource(file())).toString("base64")).toBe(png)
  })
  test.each([
    "file:///tmp/image.png",
    "https://example.com/image.png",
    "../image.png",
    "data:image/jpeg;base64," + png,
  ])("rejects a source requiring access or conversion: %s", (url) => {
    expect(() => imagePreviewSource(file(url))).toThrow("Image preview is unavailable")
  })
  test("rejects MIME mismatch, malformed base64 and encoded over-budget input", () => {
    expect(() => imagePreviewSource(file(undefined, "image/jpeg"))).toThrow()
    expect(() => imagePreviewSource(file("data:image/png;base64,!!!!"))).toThrow()
    expect(() =>
      imagePreviewSource(file("data:image/png;base64," + "A".repeat(4 * Math.ceil(IMAGE_PREVIEW_MAX_BYTES / 3) + 4))),
    ).toThrow()
  })
  test("rejects invalid magic, oversized dimensions, interlacing and animation before decompression", () => {
    const original = Buffer.from(png, "base64")
    const reject = (bytes: Buffer) =>
      expect(() => imagePreviewSource(file(`data:image/png;base64,${bytes.toString("base64")}`))).toThrow()
    const signature = Buffer.from(original)
    signature[0] = 0
    reject(signature)
    const dimensions = Buffer.from(original)
    dimensions.writeUInt32BE(4096, 16)
    dimensions.writeUInt32BE(4096, 20)
    reject(dimensions)
    const interlaced = Buffer.from(original)
    interlaced[28] = 1
    reject(interlaced)
    const animated = Buffer.from(original)
    animated.write("acTL", 37, "ascii")
    reject(animated)
  })
  test("labels cannot inject terminal controls and remain bounded", () => {
    expect(imagePreviewLabel("\x1b[31msecret\x1b[0m\nfile\x07")).toBe("secret file ")
    expect(imagePreviewLabel("x".repeat(500))).toHaveLength(200)
  })
})
