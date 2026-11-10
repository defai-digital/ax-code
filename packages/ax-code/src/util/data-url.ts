export function decodeBase64Bytes(value: string): Buffer | undefined {
  const normalized = value.replace(/\s+/g, "")
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return undefined
  return Buffer.from(normalized, "base64")
}

function decodePercentBytes(value: string): Buffer | undefined {
  const bytes = Buffer.from(value, "utf8")
  const firstEscape = bytes.indexOf(0x25)
  if (firstEscape === -1) return bytes
  let written = firstEscape
  for (let index = firstEscape; index < bytes.length; index++) {
    if (bytes[index] !== 0x25) {
      bytes[written++] = bytes[index]
      continue
    }
    const hex = bytes.toString("latin1", index + 1, index + 3)
    if (!/^[\da-f]{2}$/i.test(hex)) return undefined
    bytes[written++] = Number.parseInt(hex, 16)
    index += 2
  }
  return bytes.subarray(0, written)
}

export function decodeDataUrlBytes(url: string): Buffer | undefined {
  if (!/^data:/i.test(url)) return undefined
  const idx = url.indexOf(",")
  if (idx === -1) return undefined

  // Percent escapes encode bytes, including non-UTF-8 binary attachments.
  // Decode them before base64 so URL-escaped padding and alphabet characters work.
  const body = url.slice(idx + 1)
  const base64 = /;base64$/i.test(url.slice(0, idx))
  if (base64 && !body.includes("%")) return decodeBase64Bytes(body)
  const bytes = decodePercentBytes(body)
  if (!bytes) return undefined
  return base64 ? decodeBase64Bytes(bytes.toString("utf8")) : bytes
}

export function decodeDataUrl(url: string) {
  return decodeDataUrlBytes(url)?.toString("utf8") ?? ""
}
