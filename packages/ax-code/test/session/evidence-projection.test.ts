import { expect, test } from "vitest"
import type { ModelMessage } from "ai"
import { projectReadEvidence } from "../../src/session/evidence-projection"

const text =
  "<path>/workspace/a.ts</path>\n<type>file</type>\n<content>" + "export const a = 1;\n".repeat(100) + "</content>"
const result = (id: string, value = text): ModelMessage => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: "read", output: { type: "text", value } }],
})

test("keeps first visible full read and every result id without mutating cached conversion", () => {
  const source = [result("first"), result("second"), result("third")]
  const before = structuredClone(source)
  const projected = projectReadEvidence(source)
  expect(projected.duplicates).toBe(2)
  expect(projected.omittedBytes).toBeGreaterThan(3000)
  expect(projected.messages[0]).toEqual(source[0])
  expect(JSON.stringify(projected.messages[1])).toContain("first")
  expect(source).toEqual(before)
  expect(projectReadEvidence(source)).toEqual(projected)
})

test("rebuilds visibility after compaction or removal instead of emitting a dangling reference", () => {
  const source = [result("first", "[Old tool result content cleared]"), result("second"), result("third")]
  const projected = projectReadEvidence(source)
  expect(projected.duplicates).toBe(1)
  expect(projected.messages[1]).toEqual(source[1])
  expect(JSON.stringify(projected.messages[2])).toContain("second")
  expect(projectReadEvidence([result("third")]).duplicates).toBe(0)
})

test("does not merge changed source, instructions, small reads, or media", () => {
  const messages = [
    result("a"),
    result("b", text.replace("a = 1", "a = 2")),
    result("c", text + "<system-reminder>rules</system-reminder>"),
    result("d", text + "<system-reminder>rules</system-reminder>"),
    result("e", "short"),
    result("f", "short"),
  ]
  expect(projectReadEvidence(messages).duplicates).toBe(0)
  const media: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: "media",
        toolName: "read",
        output: { type: "content", value: [{ type: "text", text }] },
      },
    ],
  }
  expect(projectReadEvidence([media, media]).duplicates).toBe(0)
  const truncated = text + "More lines remain; total not counted"
  expect(projectReadEvidence([result("a", truncated), result("b", truncated)]).duplicates).toBe(0)
})
