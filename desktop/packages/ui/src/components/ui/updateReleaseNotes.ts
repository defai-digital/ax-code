function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    gt: ">",
    lt: "<",
    quot: '"',
    apos: "'",
    nbsp: " ",
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase()
    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return namedEntities[key] ?? match
  })
}

function removeRawTextElementBlocks(value: string, tagName: string): string {
  const needle = `<${tagName}`
  const closeNeedle = `</${tagName}`
  let remaining = value
  let output = ""

  while (remaining.length > 0) {
    const lower = remaining.toLowerCase()
    const start = lower.indexOf(needle)
    if (start === -1) {
      output += remaining
      break
    }

    const startTagEnd = lower.indexOf(">", start + needle.length)
    if (startTagEnd === -1) {
      output += remaining.slice(0, start)
      break
    }

    const closeStart = lower.indexOf(closeNeedle, startTagEnd + 1)
    if (closeStart === -1) {
      output += remaining.slice(0, start)
      break
    }

    const closeEnd = lower.indexOf(">", closeStart + closeNeedle.length)
    if (closeEnd === -1) {
      output += remaining.slice(0, start)
      break
    }

    output += remaining.slice(0, start)
    remaining = remaining.slice(closeEnd + 1)
  }

  return output
}

export function normalizeReleaseNotesForMarkdown(body: string): string {
  if (!/<\/?[a-z][\s\S]*>/i.test(body)) {
    return body
  }

  const safeBody = removeRawTextElementBlocks(removeRawTextElementBlocks(decodeHtmlEntities(body), "script"), "style")

  return safeBody
    .replace(/<\s*h([1-6])\b[^>]*>/gi, (_match, level: string) => `${"#".repeat(Math.max(2, Number(level)))} `)
    .replace(/<\s*\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<\s*li\b[^>]*>/gi, "- ")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*p\b[^>]*>/gi, "")
    .replace(/<\s*\/(?:ul|ol|div|section|article)\s*>/gi, "\n")
    .replace(/<\s*(?:ul|ol|div|section|article)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const GITHUB_RELEASES_URL = "https://github.com/defai-digital/ax-code/releases"

export function buildUpdateReleaseUrl(version: string | undefined): string {
  const trimmedVersion = version?.trim()
  if (!trimmedVersion) {
    return GITHUB_RELEASES_URL
  }

  if (trimmedVersion.startsWith("desktop-v") || trimmedVersion.startsWith("v")) {
    return `${GITHUB_RELEASES_URL}/tag/${trimmedVersion}`
  }

  return `${GITHUB_RELEASES_URL}/tag/v${trimmedVersion}`
}
