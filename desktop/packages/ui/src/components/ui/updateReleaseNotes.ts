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

export function normalizeReleaseNotesForMarkdown(body: string): string {
  if (!/<\/?[a-z][\s\S]*>/i.test(body)) {
    return body
  }

  return decodeHtmlEntities(body)
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
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
