import { expect, test } from "vitest"
import type { ModelMessage } from "ai"
import { projectToolEvidence } from "../../src/session/evidence-projection"

const text =
  "<path>/workspace/a.ts</path>\n<type>file</type>\n<content>" + "export const a = 1;\n".repeat(100) + "</content>"
const result = (id: string, value = text): ModelMessage => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: "read", output: { type: "text", value } }],
})

const grepText =
  "Found 6 matches\n" +
  Array.from(
    { length: 6 },
    (_, i) => `/workspace/src/file${i}.ts:\n  Line ${i + 1}: export const value${i} = ${i}`,
  ).join("\n") +
  "\n"
const grep = (id: string, value = grepText): ModelMessage => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: "grep", output: { type: "text", value } }],
})

const globText = Array.from({ length: 20 }, (_, i) => `/workspace/src/module-${i}/index.ts`).join("\n") + "\n"
const glob = (id: string, value = globText): ModelMessage => ({
  role: "tool",
  content: [{ type: "tool-result", toolCallId: id, toolName: "glob", output: { type: "text", value } }],
})

test("keeps first visible full read and every result id without mutating cached conversion", () => {
  const source = [result("first"), result("second"), result("third")]
  const before = structuredClone(source)
  const projected = projectToolEvidence(source)
  expect(projected.duplicates).toBe(2)
  expect(projected.omittedBytes).toBeGreaterThan(3000)
  expect(projected.messages[0]).toEqual(source[0])
  expect(JSON.stringify(projected.messages[1])).toContain("first")
  expect(source).toEqual(before)
  expect(projectToolEvidence(source)).toEqual(projected)
})

test("rebuilds visibility after compaction or removal instead of emitting a dangling reference", () => {
  const source = [result("first", "[Old tool result content cleared]"), result("second"), result("third")]
  const projected = projectToolEvidence(source)
  expect(projected.duplicates).toBe(1)
  expect(projected.messages[1]).toEqual(source[1])
  expect(JSON.stringify(projected.messages[2])).toContain("second")
  expect(projectToolEvidence([result("third")]).duplicates).toBe(0)
})

test("does not merge changed source, instructions, media, or truncated/hidden output", () => {
  const messages = [
    result("a"),
    result("b", text.replace("a = 1", "a = 2")),
    result("c", text + "<system-reminder>rules</system-reminder>"),
    result("d", text + "<system-reminder>rules</system-reminder>"),
  ]
  expect(projectToolEvidence(messages).duplicates).toBe(0)
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
  expect(projectToolEvidence([media, media]).duplicates).toBe(0)
  const truncated = text + "More lines remain; total not counted"
  expect(projectToolEvidence([result("a", truncated), result("b", truncated)]).duplicates).toBe(0)
})

test("merges an identical read output once it is larger than the pointer", () => {
  const body = "<path>/workspace/s.ts</path>\n<type>file</type>\n<content>" + "x\n".repeat(80) + "</content>"
  const messages = [result("first", body), result("second", body)]
  const projected = projectToolEvidence(messages)
  expect(projected.duplicates).toBe(1)
  expect(projected.messages[0]).toEqual(messages[0])
  expect(JSON.stringify(projected.messages[1])).toContain("first")
  // A value shorter than the pointer stays verbatim: no net size regression.
  expect(projectToolEvidence([result("a", "short"), result("b", "short")]).duplicates).toBe(0)
})

test("dedupes identical search views while retaining known truncation disclosures", () => {
  const projected = projectToolEvidence([grep("g1"), grep("g2")])
  expect(projected.duplicates).toBe(1)
  expect(projected.messages[0]).toEqual(grep("g1"))
  expect(JSON.stringify(projected.messages[1])).toContain("g1")
  expect(projected.omittedBytes).toBeGreaterThan(0)

  expect(projectToolEvidence([glob("b1"), glob("b2")]).duplicates).toBe(1)

  const changed = [grep("g1"), grep("g2", grepText.replace("Found 6 matches", "Found 7 matches"))]
  expect(projectToolEvidence(changed).duplicates).toBe(0)

  const truncated =
    grepText +
    "(Results truncated: showing 100 of 500 matches (400 hidden). Consider using a more specific path or pattern.)\n"
  expect(projectToolEvidence([grep("t1", truncated), grep("t2", truncated)]).duplicates).toBe(1)

  const truncatedGlob =
    globText + "(Results are truncated: showing first 100 results. Consider using a more specific path or pattern.)\n"
  expect(projectToolEvidence([glob("b1", truncatedGlob), glob("b2", truncatedGlob)]).duplicates).toBe(1)
})

test("does not dedupe error results or tools outside the allowlist", () => {
  const errorResult: ModelMessage = {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "e1", toolName: "grep", output: { type: "error-text", value: "boom" } },
    ],
  }
  const errorResult2: ModelMessage = {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "e2", toolName: "grep", output: { type: "error-text", value: "boom" } },
    ],
  }
  expect(projectToolEvidence([errorResult, errorResult2]).duplicates).toBe(0)

  const bash: ModelMessage = {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "x1", toolName: "bash", output: { type: "text", value: grepText } }],
  }
  const bash2: ModelMessage = {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: "x2", toolName: "bash", output: { type: "text", value: grepText } }],
  }
  expect(projectToolEvidence([bash, bash2]).duplicates).toBe(0)
})

test("references exact repeated read pages with their continuation and no hidden-content claim", () => {
  const footer = "(Showing lines 1-100. More lines remain; total not counted. Use offset=101 to continue.)"
  const page = text.replace("</content>", `\n\n${footer}\n</content>`)
  const source = [result("page1", page), result("page2", page), result("page3", page)]
  const before = structuredClone(source)
  const projected = projectToolEvidence(source)
  expect(projected.duplicates).toBe(2)
  expect(projected.messages[0]).toEqual(source[0])
  for (const message of projected.messages.slice(1)) {
    expect(JSON.stringify(message)).toContain(footer)
    expect(JSON.stringify(message)).toContain("omitted source content is still unavailable")
    expect(JSON.stringify(message)).toContain("page1")
  }
  expect(source).toEqual(before)
  expect(projectToolEvidence(source.slice(1)).messages[0]).toEqual(source[1])
  expect(projectToolEvidence([source[0], result("changed", page.replace("a = 1", "a = 2"))]).duplicates).toBe(0)
  expect(projectToolEvidence([source[0], result("changed", page.replace("offset=101", "offset=102"))]).duplicates).toBe(
    0,
  )
  expect(
    projectToolEvidence([
      result("a", page + "<system-reminder>rules</system-reminder>"),
      result("b", page + "<system-reminder>rules</system-reminder>"),
    ]).duplicates,
  ).toBe(0)
})

test("leaves unknown partial formats and clipped lines unchanged", () => {
  for (const value of [text + "Output capped in an unknown format", text + "... (line truncated to 2000 chars)"])
    expect(projectToolEvidence([result("a", value), result("b", value)]).duplicates).toBe(0)
  const context = "Showing 5 matches (results or context truncated; narrow the path or pattern).\n" + grepText
  expect(projectToolEvidence([grep("a", context), grep("b", context)]).duplicates).toBe(0)
})
