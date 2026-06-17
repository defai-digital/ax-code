import { describe, expect, test } from "bun:test"
import { buildChatHtml, generateNonce } from "../src/webview-html"

const html = buildChatHtml(generateNonce(), "vscode-resource:")

describe("chat webview html", () => {
  // #264 — the chat input must expose an accessible name beyond the placeholder.
  test("chat input textarea has an accessible label", () => {
    expect(html).toContain('id="input"')
    expect(html).toMatch(/<textarea id="input"[^>]*aria-label="Ask ax-code"/)
  })

  // #263 — empty-state and 'Chat cleared' status are tagged so they can be
  // removed once real conversation content renders.
  test("placeholder status nodes are marked and cleared on real content", () => {
    expect(html).toMatch(/<div class="status" data-placeholder="1">Type a message/)
    expect(html).toContain("'<div class=\"status\" data-placeholder=\"1\">Chat cleared</div>'")
    expect(html).toContain("function removePlaceholderStatus()")
    // Removed when the first user message, stream chunk, and final answer render.
    expect(html).toMatch(/case 'userMessage':\s*removePlaceholderStatus\(\)/)
  })

  // #262 — the final 'done' event is idempotent and keyed to the turn's bubble,
  // so a lost activeAssistantEl cannot append a duplicate assistant message.
  test("done finalization is idempotent and turn-keyed", () => {
    expect(html).toContain("let turnAssistantEl = null;")
    expect(html).toContain("const target = activeAssistantEl || turnAssistantEl;")
    expect(html).toContain("target.dataset.finalized !== '1'")
    // Fallback append only happens when nothing was rendered for the turn.
    expect(html).toContain("} else if (!target && msg.text) {")
  })
})
