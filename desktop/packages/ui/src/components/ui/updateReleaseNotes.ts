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

function hasHtmlTag(value: string): boolean {
  for (let i = 0; i < value.length - 2; i++) {
    if (value[i] !== "<") continue
    const next = value[i + 1] === "/" ? value[i + 2] : value[i + 1]
    if (next && /[a-z]/i.test(next)) return true
  }
  return false
}

function readTagName(tag: string): { closing: boolean; name: string } {
  const trimmed = tag.trimStart()
  const closing = trimmed.startsWith("/")
  const start = closing ? 1 : 0
  let end = start
  while (end < trimmed.length && /[a-z0-9]/i.test(trimmed[end] ?? "")) end++
  return { closing, name: trimmed.slice(start, end).toLowerCase() }
}

function markdownForTag(tag: string): string {
  const { closing, name } = readTagName(tag)
  if (/^h[1-6]$/.test(name)) {
    return closing ? "\n\n" : `${"#".repeat(Math.max(2, Number(name.slice(1))))} `
  }
  if (name === "li") return closing ? "\n" : "- "
  if (name === "br") return "\n"
  if (name === "p") return closing ? "\n\n" : ""
  if (name === "ul" || name === "ol" || name === "div" || name === "section" || name === "article") {
    return closing ? "\n" : ""
  }
  return ""
}

function htmlToMarkdownText(value: string): string {
  let remaining = value
  let output = ""

  while (remaining.length > 0) {
    const start = remaining.indexOf("<")
    if (start === -1) {
      output += remaining
      break
    }

    output += remaining.slice(0, start)
    const end = remaining.indexOf(">", start + 1)
    if (end === -1) {
      output += remaining.slice(start)
      break
    }
    output += markdownForTag(remaining.slice(start + 1, end))
    remaining = remaining.slice(end + 1)
  }

  return output
}

export function normalizeReleaseNotesForMarkdown(body: string): string {
  if (!hasHtmlTag(body)) {
    return body
  }

  const safeBody = removeRawTextElementBlocks(removeRawTextElementBlocks(decodeHtmlEntities(body), "script"), "style")

  return htmlToMarkdownText(safeBody)
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
