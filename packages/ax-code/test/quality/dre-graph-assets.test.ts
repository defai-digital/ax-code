import { describe, expect, test } from "vitest"
import { executionSummaryScript, live, themeScript, themeToggle } from "../../src/quality/dre-graph-assets"

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

  test("paces reloads slower for streaming detail events than lifecycle events", () => {
    const html = live({ sessionID: "session-1", directory: "src" })

    expect(html).toContain(`const gap = 2000`)
    expect(html).toContain(`const streamGap = 10000`)
    expect(html).toContain(`if (keep(data)) pull(detail.includes(data.payload.type) ? streamGap : gap)`)
    expect(html).toContain(`pull(cfg.sessionID == null ? gap : streamGap)`)
    expect(html).toContain(`if (wait && at >= waitAt) return`)
  })

  test("renders execution summary loader with script-safe session id", () => {
    const html = executionSummaryScript("<session>&\u2028")

    expect(html).toContain(`const _sid = "\\u003csession\\u003e\\u0026\\u2028";`)
    expect(html).toContain(`const _dirQuery = "";`)
    expect(html).toContain(`fetch('/graph/' + _sid + '?format=json' + _dirQuery`)
    expect(html).toContain(`if (_rendering) { _renderQueued = true; return; }`)
    expect(html).toContain(`if (_renderQueued) { _renderQueued = false; _renderSummary(); }`)
    expect(html).toContain(`window._reinitGraph = function()`)
  })

  test("scopes the execution summary graph fetch to the session directory", () => {
    const html = executionSummaryScript("session-1", "/work/my project&x")

    expect(html).toContain(`const _dirQuery = "\\u0026directory=%2Fwork%2Fmy%20project%26x";`)
  })

  test("polls for and reports the execution summary status", () => {
    const html = executionSummaryScript("session-1")

    expect(html).toContain("function _updateSummary(graph)")
    expect(html).toContain("function _summaryUnavailable()")
    expect(html).toContain("const _refresh = window.setInterval(_renderSummary, 15000)")
    expect(html).toContain("getElementById('gviz-summary-status')")
    expect(html).toContain("getElementById('gviz-summary-detail')")
  })
})
