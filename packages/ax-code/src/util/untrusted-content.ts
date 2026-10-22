/**
 * Untrusted content envelope and hidden-Unicode detector (ADR-206).
 *
 * External results (web fetch, web search, code search, MCP tool output)
 * re-enter the model context as raw text. `wrapUntrustedContent` delimits
 * such text with an `<untrusted_content source="...">` envelope so the model
 * can tell data from instructions, defangs envelope-shaped tags embedded in
 * the content (so the payload cannot close the envelope early), and strips
 * hidden Unicode characters that could reorder or disguise the text.
 *
 * Pure leaf module: no imports, no logging, no I/O — safe to use from any
 * layer. Detection is advisory; it reduces, never removes, injection risk.
 */

/** Text shorter than this (UTF-16 code units) is not worth an envelope. */
export const UNTRUSTED_CONTENT_MIN_LENGTH = 32

/**
 * True for code points ax-code treats as hidden text machinery: Unicode tag
 * characters (U+E0000..U+E007F, includes the cancel tag), bidirectional
 * embedding/override/isolate controls (U+202A..U+202E, U+2066..U+2069), and
 * zero-width characters (U+200B..U+200D, U+2060 word joiner, U+FEFF BOM).
 */
export function isHiddenUnicodeCodePoint(code: number): boolean {
  return (
    (code >= 0xe0000 && code <= 0xe007f) || // tag characters
    (code >= 0x202a && code <= 0x202e) || // bidi embedding/override controls
    (code >= 0x2066 && code <= 0x2069) || // bidi isolate controls
    (code >= 0x200b && code <= 0x200d) || // zero-width space / ZWNJ / ZWJ
    code === 0x2060 || // word joiner
    code === 0xfeff // zero-width no-break space (BOM)
  )
}

/** Count of hidden Unicode code points in `text` (surrogate-pair aware). */
export function detectHiddenUnicode(text: string): number {
  let count = 0
  for (let index = 0; index < text.length; ) {
    const code = text.codePointAt(index)!
    if (isHiddenUnicodeCodePoint(code)) count++
    index += code > 0xffff ? 2 : 1
  }
  return count
}

// Global flag is required by replace(); String.replace with a global regex
// always starts at index 0, so shared state never leaks between calls. The
// `u` flag is required so `\u{E0000}` code-point escapes (not 4-digit
// `\uXXXX` surrogates) and the surrogate-pair tag characters both work.
const HIDDEN_UNICODE_PATTERN = /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF]/gu

/** Remove every hidden Unicode character, reporting how many were dropped. */
export function stripHiddenUnicode(text: string): { text: string; removed: number } {
  const removed = detectHiddenUnicode(text)
  if (removed === 0) return { text, removed }
  return { text: text.replace(HIDDEN_UNICODE_PATTERN, ""), removed }
}

// Envelope-shaped tags, open or close, with or without attributes. Newlines
// inside the tag are tolerated ([^>] matches them) so an attribute split
// across lines cannot smuggle a live tag past the defang pass.
const ENVELOPE_TAG_PATTERN = /<(\/?)untrusted_content\b[^>]*>/gi

/**
 * Neutralize envelope tags that appear inside content: `<untrusted_content ...>`
 * becomes `[untrusted_content]` and `</untrusted_content>` becomes
 * `[/untrusted_content]`. Attributes are dropped so a hostile payload cannot
 * speak in the envelope's voice, and the bracketed form cannot terminate the
 * real envelope.
 */
export function defangUntrustedContentTags(text: string): string {
  return text.replace(ENVELOPE_TAG_PATTERN, (_match, slash: string) => `[${slash}untrusted_content]`)
}

/** Restrict a source label to characters safe inside a double-quoted attribute. */
export function sanitizeUntrustedSource(source: string): string {
  const cleaned = source
    .replace(/[^a-zA-Z0-9_.:@/-]+/g, "_")
    .replace(/^_+/, "")
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : "unknown"
}

/**
 * True when `text` already is a complete untrusted-content envelope.
 *
 * The outer shape alone is not enough: a hostile payload can copy it and
 * embed an early close tag followed by its own instructions. Only a single
 * live opening and closing tag is an envelope this module produced; anything
 * else goes through defang/wrap again.
 */
export function isWrappedUntrustedContent(text: string): boolean {
  if (!text.startsWith("<untrusted_content ") || !text.endsWith("</untrusted_content>")) return false
  return text.match(ENVELOPE_TAG_PATTERN)?.length === 2
}

/**
 * Wrap external text in the untrusted-content envelope.
 *
 * - Text below `UNTRUSTED_CONTENT_MIN_LENGTH` is returned unchanged.
 * - Already-wrapped text is returned unchanged (never double-wrapped).
 * - Hidden Unicode is removed and reported in a one-line note inside the
 *   envelope; embedded envelope tags are defanged.
 */
export function wrapUntrustedContent(text: string, source: string): string {
  if (text.length < UNTRUSTED_CONTENT_MIN_LENGTH) return text
  if (isWrappedUntrustedContent(text)) return text
  const { text: stripped, removed } = stripHiddenUnicode(text)
  const body = defangUntrustedContentTags(stripped)
  const note = removed > 0 ? `[${removed} hidden Unicode character${removed === 1 ? "" : "s"} removed]\n` : ""
  return `<untrusted_content source="${sanitizeUntrustedSource(source)}">\n${note}${body}\n</untrusted_content>`
}
