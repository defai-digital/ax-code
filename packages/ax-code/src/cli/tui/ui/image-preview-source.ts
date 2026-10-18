import stripAnsi from "strip-ansi"

export const IMAGE_PREVIEW_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_PREVIEW_MAX_PIXELS = 1024 * 1024
const PREFIX = "data:image/png;base64,"

export function isImagePreviewCandidate(file: { mime: string; url: string }) {
  return file.mime === "image/png" && file.url.startsWith(PREFIX)
}

export function imagePreviewLabel(value: string) {
  return stripAnsi(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, 200)
}

/** Only session-carried PNG bytes; this boundary never reads a path or URL. */
export function imagePreviewSource(file: { mime: string; url: string }): Uint8Array {
  const invalid = () => new Error("Image preview is unavailable")
  if (!isImagePreviewCandidate(file)) throw invalid()
  if (file.url.length > PREFIX.length + 4 * Math.ceil(IMAGE_PREVIEW_MAX_BYTES / 3)) throw invalid()
  const encoded = file.url.slice(PREFIX.length)
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw invalid()
  const bytes = Buffer.from(encoded, "base64")
  if (bytes.length > IMAGE_PREVIEW_MAX_BYTES || bytes.length < 33) throw invalid()
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (signature.some((value, index) => bytes[index] !== value)) throw invalid()
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") throw invalid()
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!width || !height || width > 4096 || height > 4096 || width * height > IMAGE_PREVIEW_MAX_PIXELS) throw invalid()
  if (bytes[24] !== 8 || bytes[28] !== 0) throw invalid()
  // Reject animated PNG rather than silently presenting an arbitrary frame.
  // The framework validates chunk ordering, CRCs and decompression bounds.
  for (let offset = 8; offset < bytes.length; ) {
    if (offset + 12 > bytes.length) throw invalid()
    const end = offset + 12 + bytes.readUInt32BE(offset)
    if (end > bytes.length || bytes.toString("ascii", offset + 4, offset + 8) === "acTL") throw invalid()
    offset = end
  }
  return bytes
}
