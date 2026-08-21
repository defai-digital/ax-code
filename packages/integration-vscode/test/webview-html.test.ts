import { describe, expect, test } from "vitest"
import { buildChatHtml, generateNonce } from "../src/webview-html"

const html = buildChatHtml(generateNonce(), "vscode-resource:")

describe("chat webview html", () => {
  // #264 — the chat input must expose an accessible name beyond the placeholder.
  test("chat input textarea has an accessible label", () => {
    expect(html).toContain('id="input"')
    expect(html).toMatch(/<textarea id="input"[^>]*aria-label="Ask AX Code"/)
  })

  // #263 — empty-state and 'Chat cleared' status are tagged so they can be
  // removed once real conversation content renders.
  test("placeholder status nodes are marked and cleared on real content", () => {
    expect(html).toMatch(/<div class="status" data-placeholder="1">Ask AX Code/)
    expect(html).toContain('\'<div class="status" data-placeholder="1">Chat cleared</div>\'')
    expect(html).toContain("function removePlaceholderStatus()")
    // Removed when the first user message, stream chunk, and final answer render.
    expect(html).toMatch(/case 'userMessage':\s*removePlaceholderStatus\(\)/)
  })

  // #262 — the final 'done' event is idempotent and keyed to the turn's bubble,
  // so a lost activeAssistantEl cannot append a duplicate assistant message.
  test("done finalization is idempotent and turn-keyed", () => {
    expect(html).toContain("let turnAssistantEl = null;")
    expect(html).toContain("const target = activeAssistantEl || turnAssistantEl;")
    expect(html).toContain("if (target.dataset.finalized === '1') return;")
    // Fallback append only happens when nothing was rendered for the turn.
    expect(html).toMatch(/function applyDone\(msg, target\)[\s\S]*else if \(msg\.text\)/)
  })

  // Code blocks get a Copy / Insert / New file toolbar, added client-side
  // after the markdown render (CSP forbids inline handlers, so clicks are
  // delegated through data attributes).
  test("code blocks get an action toolbar via delegated clicks", () => {
    expect(html).toContain("function decorateCodeBlocks(root)")
    expect(html).toContain("'code-toolbar'")
    expect(html).toContain("data-code-action")
    expect(html).toContain("type: 'insertAtCursor'")
    expect(html).toContain("type: 'openInNewFile'")
    // No inline event handlers anywhere — CSP compliance.
    expect(html).not.toMatch(/<button[^>]*onclick=/)
  })

  // Clipboard support: clipboard API with an execCommand fallback, plus a
  // per-message Copy button keyed to the raw markdown via WeakMap.
  test("copy support covers code blocks and whole messages", () => {
    expect(html).toContain("function copyText(text, btn)")
    expect(html).toContain("navigator.clipboard.writeText")
    expect(html).toContain("document.execCommand('copy')")
    expect(html).toContain("const messageTexts = new WeakMap();")
    expect(html).toContain("data-copy-message")
  })

  // Prompt input: history recall, image paste, and prefill/insert channels
  // from the extension host.
  test("input supports history, image paste, and host-driven prefill", () => {
    expect(html).toContain("function historyNavigate(direction)")
    expect(html).toContain("vscode.setState({ inputHistory: inputHistory })")
    expect(html).toContain("inputEl.addEventListener('paste', handlePaste)")
    expect(html).toContain("readAsDataURL(file)")
    expect(html).toContain("case 'prefill':")
    expect(html).toContain("case 'insertText':")
  })

  // Streaming must not destroy an in-progress text selection in the bubble.
  test("stream renders are deferred while the user selects text", () => {
    expect(html).toContain("function selectionInside(el)")
    expect(html).toContain("sel.focusNode")
    expect(html).toContain("deferredStream = { el: el, html: msg.html };")
    // The final done render must defer too; otherwise it still destroys a
    // selection that happens to be active as streaming completes.
    expect(html).toContain("deferredStream = { el: target, html: msg.html, done: msg };")
    expect(html).toContain("flushDeferredStream()")
  })

  // Prefill must never destroy an unsent draft — it appends below it instead.
  test("prefill appends to an existing draft instead of replacing it", () => {
    expect(html).toContain(
      "inputEl.value = draft ? inputEl.value.replace(/\\s+$/, '') + '\\n\\n' + incoming : incoming;",
    )
  })

  // Persisted state can come from an older version with a different shape —
  // the history restore must not trust it blindly.
  test("input history restore validates persisted state", () => {
    expect(html).toContain("Array.isArray(savedState.inputHistory)")
    expect(html).toContain(".filter((entry) => typeof entry === 'string' && entry.trim().length > 0)")
    expect(html).toContain(".slice(-HISTORY_LIMIT)")
  })

  // The no-stream fallback bubble gets the same finishing touches as the
  // streamed path: token count and a scroll into view.
  test("done fallback bubble renders tokens and scrolls into view", () => {
    const fallback = html.slice(html.indexOf("function finalizeAssistant"), html.indexOf("document.addEventListener"))
    expect(fallback).toContain("'agent-badge'")
    expect(fallback).toContain("' tokens'")
    expect(fallback).toContain("scrollToBottom(false)")
  })

  // Clearing a turn must also discard any deferred render and fence out late
  // stream chunks racing with the host-side abort.
  test("clear drops deferred rendering and finalizes the old turn", () => {
    const clear = html.slice(html.indexOf("function clearChat()"), html.indexOf("function removePlaceholderStatus()"))
    expect(clear).toContain("deferredStream = null")
    expect(clear).toContain("turnFinalized = true")
  })

  // Terminal turn states fence both text and tool SSE events; otherwise a
  // late tool snapshot can repopulate a transcript immediately after Clear.
  test("finalized turns ignore late tool updates", () => {
    const toolUpdate = html.slice(html.indexOf("case 'toolUpdate':"), html.indexOf("case 'done':"))
    expect(toolUpdate).toContain("if (turnFinalized) break;")
    expect(html).toMatch(/case 'error':\s*turnFinalized = true;/)
  })
})
