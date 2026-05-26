import { describe, expect, test } from "bun:test"
import { escapeHtml, renderMarkdown, sanitizeHtml } from "../src/markdown"

describe("escapeHtml", () => {
  test("escapes the five XML-significant characters", () => {
    expect(escapeHtml(`<a href="x">'A&B'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;A&amp;B&#39;&lt;/a&gt;")
  })

  test("leaves plain text untouched", () => {
    expect(escapeHtml("hello world 123")).toBe("hello world 123")
  })
})

describe("sanitizeHtml", () => {
  test("strips script tags wholesale", () => {
    expect(sanitizeHtml(`<p>hi</p><script>alert(1)</script>`)).toBe(`<p>hi</p>`)
  })

  test("strips embedded dangerous element contents", () => {
    expect(sanitizeHtml(`<style>body{display:none}</style><p>ok</p>`)).toBe(`<p>ok</p>`)
    expect(sanitizeHtml(`<iframe src="evil">fallback</iframe><p>ok</p>`)).toBe(`<p>ok</p>`)
  })

  test("strips on* event-handler attributes", () => {
    const out = sanitizeHtml(`<a href="https://x" onclick="bad()">click</a>`)
    expect(out).toBe(`<a href="https://x">click</a>`)
  })

  test("strips javascript: hrefs", () => {
    const out = sanitizeHtml(`<a href="javascript:alert(1)">click</a>`)
    expect(out).toBe(`<a>click</a>`)
  })

  test("strips data: hrefs (no data URL exfiltration)", () => {
    // Plain data: URL is rejected by SAFE_URL.
    expect(sanitizeHtml(`<a href="data:text/html,evil">click</a>`)).toBe(`<a>click</a>`)
    // Even when the attribute contains payload-like markup, the result
    // contains no <script>/<iframe> and no data: scheme.
    const tricky = sanitizeHtml(`<a href="data:text/html,<script>x</script>">click</a>`)
    expect(tricky).not.toMatch(/<script|<iframe|data:/i)
  })

  test("strips iframe entirely", () => {
    expect(sanitizeHtml(`<iframe src="evil"></iframe>`)).toBe(``)
  })

  test("preserves allowed tags and attributes", () => {
    const html = `<pre><code class="hljs">x</code></pre><a href="https://example.com" title="Ex">link</a>`
    expect(sanitizeHtml(html)).toBe(html)
  })

  test("drops disallowed attributes on allowed tags", () => {
    const out = sanitizeHtml(`<p id="x" class="y">hi</p>`)
    expect(out).toBe(`<p>hi</p>`)
  })

  test("allows safe relative and fragment hrefs", () => {
    const cases = [
      `<a href="/page">x</a>`,
      `<a href="./page">x</a>`,
      `<a href="../page">x</a>`,
      `<a href="#section">x</a>`,
      `<a href="mailto:a@b">x</a>`,
    ]
    for (const html of cases) {
      expect(sanitizeHtml(html)).toBe(html)
    }
  })

  test("preserves table markup", () => {
    const html = `<table><thead><tr><th align="left">A</th></tr></thead><tbody><tr><td align="right">1</td></tr></tbody></table>`
    expect(sanitizeHtml(html)).toBe(html)
  })
})

describe("renderMarkdown", () => {
  test("returns empty string for falsy input", () => {
    expect(renderMarkdown("")).toBe("")
  })

  test("renders bold + code", () => {
    const out = renderMarkdown("**bold** and `code`")
    expect(out).toContain("<strong>bold</strong>")
    expect(out).toContain("<code>code</code>")
  })

  test("renders fenced code blocks", () => {
    const out = renderMarkdown("```\nhello\n```")
    expect(out).toContain("<pre>")
    expect(out).toContain("hello")
  })

  test("renders lists with line-break-as-br", () => {
    const out = renderMarkdown("- one\n- two")
    expect(out).toContain("<li>one")
    expect(out).toContain("<li>two")
  })

  test("sanitizes injected HTML inside markdown", () => {
    const out = renderMarkdown(`Hello <img src="x" onerror="alert(1)">`)
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("<img")
  })
})
