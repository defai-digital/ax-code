const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })

/** String paths must identify the original file, never a lossy replacement. */
export function decodeGrepPath(value: { text: string } | { bytes: string }): string | undefined {
  if ("text" in value) return value.text
  try {
    return decoder.decode(Buffer.from(value.bytes, "base64"))
  } catch {
    return undefined
  }
}
