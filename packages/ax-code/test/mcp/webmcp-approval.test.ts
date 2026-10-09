import { expect, test } from "vitest"
import { webMcpApprovalLines } from "../../src/mcp/webmcp-approval"

test("approval shows bridge, page tool, origins and one-call limitations without raw input", () => {
  const lines = webMcpApprovalLines({
    server: "bridge",
    tool: "execute_webmcp_tool",
    pageId: 2,
    toolName: "fixture_echo",
    allowedOrigins: ["https://example.test"],
    inputBytes: 24,
    input: "private payload",
  }).join("\n")
  for (const value of [
    "Bridge: bridge",
    "Page ID: 2",
    "Page tool: fixture_echo",
    "https://example.test",
    "24 bytes",
    "untrusted",
    "applies once",
    "not an atomic",
  ]) {
    expect(lines).toContain(value)
  }
  expect(lines).not.toContain("private payload")
})

test("approval shows the listed page origin and flags conflicting or missing annotations", () => {
  const listed = webMcpApprovalLines({
    server: "bridge",
    tool: "execute_webmcp_tool",
    pageId: 2,
    toolName: "fixture_echo",
    pageOrigin: "https://example.test",
    allowedOrigins: ["https://example.test"],
    annotations: { readOnly: true, untrustedContent: false, consequential: true },
  }).join("\n")
  expect(listed).toContain("Page origin: https://example.test")
  expect(listed).toContain("CONSEQUENTIAL")
  expect(listed).toContain("Conflicting page hints")
  expect(listed).not.toContain("read-only (page-asserted")
  const missing = webMcpApprovalLines({ tool: "execute_webmcp_tool", toolName: "fixture_echo" }).join("\n")
  expect(missing).toContain("No page annotations were listed")
})

test("approval warns on empty annotations instead of reading them as a clean bill of health", () => {
  const empty = webMcpApprovalLines({
    tool: "execute_webmcp_tool",
    toolName: "fixture_echo",
    annotations: { readOnly: false, untrustedContent: false, consequential: false },
  }).join("\n")
  expect(empty).toContain("No reliable page annotations")
  expect(empty).toContain("consequential")
  const hintless = webMcpApprovalLines({
    tool: "execute_webmcp_tool",
    toolName: "fixture_echo",
    annotations: { untrustedContent: true },
  }).join("\n")
  expect(hintless).toContain("untrusted content")
  expect(hintless).toContain("No reliable page annotations")
  const readonly = webMcpApprovalLines({
    tool: "execute_webmcp_tool",
    toolName: "fixture_echo",
    annotations: { readOnly: true },
  }).join("\n")
  expect(readonly).toContain("read-only (page-asserted")
  expect(readonly).not.toContain("No reliable page annotations")
})

test("approval handles missing metadata and strips terminal controls", () => {
  expect(webMcpApprovalLines({}).join("\n")).toContain("(unknown)")
  const lines = webMcpApprovalLines({
    server: "\x1b[31mhost\nforged",
    toolName: "x".repeat(10_000),
    allowedOrigins: [null],
  })
  expect(lines.every((line) => !/[\u0000-\u001f\u007f-\u009f]/.test(line))).toBe(true)
  expect(lines.join("\n").length).toBeLessThan(1000)
  // Bidi overrides, zero-width marks and separators cannot reorder the summary.
  const spoofed = webMcpApprovalLines({ server: "a\u202eb\u200bc\u2028d", tool: "execute_webmcp_tool" }).join("\n")
  expect(spoofed).toContain("Bridge: abcd")
  expect(/[\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2028\u2029]/.test(spoofed)).toBe(false)
})

test("approval counts origins beyond the display cap and marks truncated labels", () => {
  const origins = Array.from({ length: 10 }, (_, index) => `https://o${index}.test`)
  const lines = webMcpApprovalLines({ server: "bridge", tool: "navigate_page", allowedOrigins: origins }).join("\n")
  expect(lines).toContain("(+2 more)")
  const long = webMcpApprovalLines({ server: "b".repeat(300), tool: "list_pages" }).join("\n")
  expect(long).toContain("…(truncated)")
})
