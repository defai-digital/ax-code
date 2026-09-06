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

test("approval handles missing metadata and strips terminal controls", () => {
  expect(webMcpApprovalLines({}).join("\n")).toContain("(unknown)")
  const lines = webMcpApprovalLines({
    server: "\x1b[31mhost\nforged",
    toolName: "x".repeat(10_000),
    allowedOrigins: [null],
  })
  expect(lines.every((line) => !/[\u0000-\u001f\u007f-\u009f]/.test(line))).toBe(true)
  expect(lines.join("\n").length).toBeLessThan(1000)
})
