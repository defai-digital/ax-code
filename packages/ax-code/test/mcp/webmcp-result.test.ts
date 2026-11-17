import { expect, test, vi } from "vitest"
import { boundReadResult, visibleSnapshotNodes } from "../../src/mcp/webmcp-result"
import { parseStructuredSnapshot } from "../../src/mcp/webmcp-snapshot"

// Payload parsing and sanitization must stay usable without loading profile
// configuration, launch policy, or permission/connection state.
vi.mock("../../src/mcp/webmcp-profile", () => {
  throw new Error("WebMCP payload helpers must not load profile policy")
})

test("standalone result sanitization redacts secrets and local paths before labeling", () => {
  const result = {
    content: [
      {
        type: "text",
        text: "at https://user:password@example.test/app.js?%74oken=fixture#fragment\nat file:///home/fixture/app.js",
      },
    ],
  }
  boundReadResult("get_console_message", result, "https://example.test")
  expect(result.content).toEqual([
    { type: "text", text: "[Untrusted web content from https://example.test]" },
    {
      type: "text",
      text: "at https://example.test/app.js?%74oken=[redacted]\nat file://[local path redacted]",
    },
  ])
})

test("standalone snapshot helpers only admit nodes whose lines survive truncation", () => {
  const result = {
    content: [
      {
        type: "text",
        text: [
          'uid=root RootWebArea "App"',
          '  uid=visible button "Save"',
          "x".repeat(40 * 1024),
          '  uid=hidden button "Pay"',
        ].join("\n"),
      },
    ],
    structuredContent: {
      snapshot: {
        id: "root",
        role: "RootWebArea",
        name: "App",
        children: [
          { id: "visible", role: "button", name: "Save" },
          { id: "hidden", role: "button", name: "Pay" },
        ],
      },
    },
  }
  const nodes = parseStructuredSnapshot(result)
  expect(nodes?.size).toBe(3)
  if (!nodes) throw new Error("Expected a structured snapshot")
  boundReadResult("take_snapshot", result, "https://example.test")
  expect([...visibleSnapshotNodes(result, nodes)!.keys()]).toEqual(["root", "visible"])
  expect(result.content.map((part) => part.text).join("\n")).toContain("lines were omitted")
})
