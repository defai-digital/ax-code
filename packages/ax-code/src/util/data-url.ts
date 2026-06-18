export function decodeDataUrl(url: string) {
  const idx = url.indexOf(",")
  if (idx === -1) return ""

  const head = url.slice(0, idx)
  const body = url.slice(idx + 1)
  try {
    if (head.includes(";base64")) {
      const normalized = body.replace(/\s+/g, "")
      if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return ""
      return Buffer.from(normalized, "base64").toString("utf8")
    }
    return decodeURIComponent(body)
  } catch {
    return ""
  }
}
