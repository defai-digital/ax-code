import { describe, expect, test } from "bun:test"
import { live, mermaidScript, themeScript, themeToggle } from "../../src/quality/dre-graph-assets"

describe("quality.dre-graph-assets", () => {
  test("renders theme bootstrap and toggle scripts", () => {
    expect(themeScript()).toContain(`localStorage.getItem('ax-theme')`)

    const html = themeToggle()
    expect(html).toContain(`id="theme-btn"`)
    expect(html).toContain(`function axToggleTheme()`)
    expect(html).toContain(`window._reinitGraph`)
  })

  test("renders index live polling config with encoded directory", () => {
    const html = live({ directory: "src path&<" })

    expect(html).toContain(`const cfg = {"sessionID":null,"directory":"src path\\u0026\\u003c"`)
    expect(html).toContain(`/dre-graph/fingerprint?directory=src%20path%26%3C`)
    expect(html).toContain(`new EventSource("/global/event")`)
  })

  test("renders session live polling config with script-safe JSON", () => {
    const html = live({ sessionID: "session<script>\u2028", directory: "src" })

    expect(html).toContain(`"sessionID":"session\\u003cscript\\u003e\\u2028"`)
    expect(html).toContain(`/dre-graph/session/session\\u003cscript\\u003e\\u2028/fingerprint?directory=src`)
    expect(html).toContain(`const allow = cfg.sessionID == null ? session : [...session, ...detail]`)
  })

  test("renders mermaid graph loader with script-safe session id", () => {
    const html = mermaidScript("<session>&\u2028")

    expect(html).toContain(`const _sid = "\\u003csession\\u003e\\u0026\\u2028";`)
    expect(html).toContain(`fetch('/graph/' + _sid + '?format=svggantt'`)
    expect(html).toContain(`if (_rendering) { _renderQueued = true; return; }`)
    expect(html).toContain(`if (_renderQueued) { _renderQueued = false; _renderGraph(); }`)
    expect(html).toContain(`window._reinitGraph = function()`)
  })

  test("sanitizes fetched SVG before inserting graph markup", () => {
    const html = mermaidScript("session-1")

    expect(html).toContain("function _replaceGraphSvg(el,text)")
    expect(html).toContain("new DOMParser().parseFromString(text, 'image/svg+xml')")
    expect(html).toContain("svg.querySelectorAll('script,foreignObject')")
    expect(html).toContain("name.startsWith('on') || value.startsWith('javascript:')")
    expect(html).toContain("el.replaceChildren(document.importNode(svg, true))")
    expect(html).toContain("if (el) _replaceGraphSvg(el, text);")
    expect(html).not.toContain("if (el) el.innerHTML = text;")
  })
})
