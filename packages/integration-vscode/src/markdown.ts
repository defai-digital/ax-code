import { marked } from "marked"

export function renderMarkdown(text: string): string {
  if (!text) {
    return ""
  }
  try {
    const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
    return sanitizeHtml(html)
  } catch {
    return escapeHtml(text)
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Minimal HTML sanitizer tailored for markdown output.
// Strips unsafe tags, every on* attribute, and non-safe URL schemes.
// CSP already blocks inline/loaded scripts; this closes remaining vectors
// (form actions, iframe embeds, javascript: / data: hrefs, srcdoc, etc.).
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
])
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
  span: new Set(["class"]),
  td: new Set(["align"]),
  th: new Set(["align"]),
}
const SAFE_URL = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i
const DROP_ELEMENT_CONTENT_TAGS = ["script", "style", "iframe", "object", "embed", "svg", "math", "textarea", "title"]
const DROP_ELEMENT_CONTENT_RE = new RegExp(
  `<(${DROP_ELEMENT_CONTENT_TAGS.join("|")})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
  "gi",
)
const DROP_EMPTY_ELEMENT_RE = new RegExp(`<(${DROP_ELEMENT_CONTENT_TAGS.join("|")})\\b[^>]*\\/?>`, "gi")

export function sanitizeHtml(html: string): string {
  return html
    .replace(DROP_ELEMENT_CONTENT_RE, "")
    .replace(DROP_EMPTY_ELEMENT_RE, "")
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_match, closing, rawName, attrs) => {
      const name = String(rawName).toLowerCase()
      if (!ALLOWED_TAGS.has(name)) {
        return ""
      }
      if (closing) {
        return `</${name}>`
      }

      const allowed = ALLOWED_ATTRS[name]
      if (!allowed) {
        return `<${name}>`
      }

      let rewritten = ""
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g
      let m: RegExpExecArray | null
      while ((m = attrRe.exec(attrs)) !== null) {
        const attr = m[1].toLowerCase()
        if (attr.startsWith("on")) {
          continue
        }
        if (!allowed.has(attr)) {
          continue
        }
        const value = m[3] ?? m[4] ?? m[5] ?? ""
        if ((attr === "href" || attr === "src") && !SAFE_URL.test(value.trim())) {
          continue
        }
        rewritten += ` ${attr}="${value.replace(/"/g, "&quot;")}"`
      }
      return `<${name}${rewritten}>`
    })
}
