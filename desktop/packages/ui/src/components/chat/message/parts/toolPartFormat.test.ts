import { describe, expect, test } from "vitest"
import type { ToolPart as ToolPartType } from "@ax-code/sdk/v2"

import {
  buildWritePreviewPatch,
  formatDuration,
  getFirstChangedLineFromMetadata,
  getToolDescription,
  getToolDescriptionPath,
  getToolDiagnosticSection,
  getToolOutputLanguage,
  getToolOutputText,
  normalizeToolName,
  parseDiffStats,
  parseQuestionOutput,
  parseWriteLineCount,
} from "./toolPartFormat"

function toolPart(tool: string, state: Record<string, unknown> = {}): ToolPartType {
  return {
    id: "tool-1",
    type: "tool",
    tool,
    state,
  } as ToolPartType
}

describe("normalizeToolName", () => {
  test("returns an empty string for non-string input", () => {
    expect(normalizeToolName(undefined)).toBe("")
    expect(normalizeToolName(null)).toBe("")
    expect(normalizeToolName("")).toBe("")
    expect(normalizeToolName("   ")).toBe("")
  })

  test("trims and lowercases plain names", () => {
    expect(normalizeToolName(" Bash ")).toBe("bash")
  })

  test("keeps only the last segment of dotted names", () => {
    expect(normalizeToolName("mcp.server.Read")).toBe("read")
    expect(normalizeToolName("ax.BASH")).toBe("bash")
  })

  test("keeps names that collapse to no dotted segments", () => {
    expect(normalizeToolName("...")).toBe("...")
  })
})

describe("formatDuration", () => {
  test("formats elapsed seconds with one decimal", () => {
    expect(formatDuration(1000, 2500)).toBe("1.5s")
    expect(formatDuration(1000, undefined, 4000)).toBe("3.0s")
  })

  test("caps durations at five minutes", () => {
    expect(formatDuration(0, 10 * 60 * 1000)).toBe("300.0s")
  })

  test("rounds sub-50ms completed durations up to 0.1s", () => {
    expect(formatDuration(1000, 1001)).toBe("0.1s")
    expect(formatDuration(1000, 999)).toBe("0.1s")
  })

  test("keeps sub-50ms running durations at their real value", () => {
    expect(formatDuration(1000, undefined, 1001)).toBe("0.0s")
  })
})

describe("parseDiffStats", () => {
  test("returns null without diff content", () => {
    expect(parseDiffStats(undefined)).toBeNull()
    expect(parseDiffStats({})).toBeNull()
    expect(parseDiffStats({ patch: "   " })).toBeNull()
  })

  test("counts added and removed lines while skipping file headers", () => {
    const patch = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,2 +1,2 @@", "-old", "+new", " context"].join("\n")

    expect(parseDiffStats({ patch })).toEqual({ added: 1, removed: 1 })
  })

  test("falls back to metadata.diff and object-shaped patches", () => {
    expect(parseDiffStats({ diff: "+x\n-y" })).toEqual({ added: 1, removed: 1 })
    expect(parseDiffStats({ patch: { patch: "+only" } })).toEqual({ added: 1, removed: 0 })
  })

  test("returns null when both counts are zero", () => {
    expect(parseDiffStats({ patch: " context only" })).toBeNull()
  })
})

describe("parseWriteLineCount", () => {
  test("returns null without string content", () => {
    expect(parseWriteLineCount(undefined)).toBeNull()
    expect(parseWriteLineCount({})).toBeNull()
    expect(parseWriteLineCount({ content: 42 })).toBeNull()
    expect(parseWriteLineCount({ content: "" })).toBeNull()
  })

  test("counts newline-separated lines", () => {
    expect(parseWriteLineCount({ content: "one" })).toBe(1)
    expect(parseWriteLineCount({ content: "a\nb\nc" })).toBe(3)
    expect(parseWriteLineCount({ content: "a\n" })).toBe(2)
  })
})

describe("buildWritePreviewPatch", () => {
  test("returns undefined for blank content", () => {
    expect(buildWritePreviewPatch("src/a.ts", "   \n ")).toBeUndefined()
  })

  test("builds an all-additions unified patch", () => {
    expect(buildWritePreviewPatch("src/new.ts", "a\nb")).toBe(
      ["--- /dev/null", "+++ b/src/new.ts", "@@ -0,0 +1,2 @@", "+a", "+b"].join("\n"),
    )
  })

  test("strips the leading slash from absolute paths", () => {
    expect(buildWritePreviewPatch("/abs/path.ts", "x")).toContain("+++ b/abs/path.ts")
  })

  test("falls back to a synthetic file name and normalizes CRLF", () => {
    const patch = buildWritePreviewPatch(undefined, "a\r\nb")

    expect(patch).toContain("+++ b/new-file")
    expect(patch).toContain("@@ -0,0 +1,2 @@")
    expect(patch).toContain("+a\n+b")
  })
})

describe("getFirstChangedLineFromMetadata", () => {
  test("ignores tools without changed-line support", () => {
    expect(getFirstChangedLineFromMetadata("bash", { patch: "+x" })).toBeUndefined()
    expect(getFirstChangedLineFromMetadata("edit")).toBeUndefined()
  })

  test("returns the new-file line number of the first added line", () => {
    const patch = ["--- a/f", "+++ b/f", "@@ -10,2 +10,3 @@", " ctx", "-old", "+new"].join("\n")

    expect(getFirstChangedLineFromMetadata("edit", { patch })).toBe(11)
  })

  test("falls back to the first hunk start when nothing was added", () => {
    const patch = ["@@ -5,1 +5,1 @@", " ctx"].join("\n")

    expect(getFirstChangedLineFromMetadata("multiedit", { patch })).toBe(5)
  })

  test("reads the first file patch when no top-level patch exists", () => {
    const metadata = { files: [{ patch: "@@ -0,0 +3,1 @@\n+line" }] }

    expect(getFirstChangedLineFromMetadata("apply_patch", metadata)).toBe(3)
  })
})

describe("getToolDiagnosticSection", () => {
  test("returns null for unsupported tools or missing diagnostics", () => {
    expect(getToolDiagnosticSection("bash", {}, {}, "/repo")).toBeNull()
    expect(getToolDiagnosticSection("edit", { filePath: "src/a.ts" }, undefined, "/repo")).toBeNull()
    expect(getToolDiagnosticSection("edit", { filePath: "src/a.ts" }, {}, "/repo")).toBeNull()
  })

  test("normalizes error diagnostics keyed by the input path", () => {
    const section = getToolDiagnosticSection(
      "edit",
      { filePath: "src/app.ts" },
      {
        diagnostics: {
          "src/app.ts": [
            { message: " type error ", severity: 1, range: { start: { line: 0, character: 2 } } },
            { message: "warning", severity: 2, range: { start: { line: 5, character: 0 } } },
            { severity: 1 },
          ],
        },
      },
      "/repo",
    )

    expect(section).toEqual({
      displayPath: "src/app.ts",
      diagnostics: [{ message: "type error", line: 1, character: 3 }],
      remaining: 0,
    })
  })

  test("matches diagnostics keyed by the absolute path", () => {
    const section = getToolDiagnosticSection(
      "write",
      { filePath: "src/app.ts" },
      { diagnostics: { "/repo/src/app.ts": [{ message: "err" }] } },
      "/repo",
    )

    expect(section?.diagnostics).toEqual([{ message: "err", line: 1, character: 1 }])
    expect(section?.displayPath).toBe("src/app.ts")
  })

  test("caps visible diagnostics and reports the remaining count", () => {
    const diagnostics = Array.from({ length: 7 }, (_, index) => ({ message: `err ${index}` }))
    const section = getToolDiagnosticSection(
      "edit",
      { filePath: "src/app.ts" },
      { diagnostics: { "src/app.ts": diagnostics } },
      "/repo",
    )

    expect(section?.diagnostics).toHaveLength(5)
    expect(section?.remaining).toBe(2)
  })

  test("resolves absolute input paths back to a relative display path", () => {
    const section = getToolDiagnosticSection(
      "edit",
      { filePath: "/repo/src/app.ts" },
      { diagnostics: { "/repo/src/app.ts": [{ message: "err" }] } },
      "/repo",
    )

    expect(section?.displayPath).toBe("src/app.ts")
  })
})

describe("parseQuestionOutput", () => {
  test("parses question/answer pairs from the tool output", () => {
    const output = 'User has answered your questions: "Q1"="A1", "Q2"="line one\nline two". You can now proceed.'

    expect(parseQuestionOutput(output)).toEqual([
      { question: "Q1", answer: "A1" },
      { question: "Q2", answer: "line one\nline two" },
    ])
  })

  test("returns null when the output does not match the expected shape", () => {
    expect(parseQuestionOutput("something else")).toBeNull()
    expect(parseQuestionOutput("User has answered your questions: nothing. You can now proceed")).toBeNull()
  })
})

describe("getToolDescriptionPath", () => {
  test("resolves edit/read/write file paths relative to the current directory", () => {
    const edit = toolPart("edit", { input: { filePath: "/repo/src/a.ts" } })
    const read = toolPart("read", { input: { path: "src/b.ts" } })
    const write = toolPart("write", { input: { file_path: "src/c.ts" } })

    expect(getToolDescriptionPath(edit, edit.state, "/repo")).toBe("src/a.ts")
    expect(getToolDescriptionPath(read, read.state, "/repo")).toBe("src/b.ts")
    expect(getToolDescriptionPath(write, write.state, "/repo")).toBe("src/c.ts")
  })

  test("returns null for multi-file apply_patch parts", () => {
    const part = toolPart("apply_patch", {
      metadata: { files: [{ relativePath: "a.ts" }, { relativePath: "b.ts" }] },
    })

    expect(getToolDescriptionPath(part, part.state, "/repo")).toBeNull()
  })
})

describe("getToolDescription", () => {
  test("prefers the file path label when available", () => {
    const part = toolPart("edit", { input: { filePath: "/repo/src/a.ts" } })

    expect(getToolDescription(part, part.state, "/repo")).toBe("src/a.ts")
  })

  test("summarizes multi-file apply_patch parts", () => {
    const part = toolPart("apply_patch", {
      metadata: { files: [{ relativePath: "a.ts" }, { relativePath: "b.ts" }] },
    })

    expect(getToolDescription(part, part.state, "/repo")).toBe("2 files")
  })

  test("uses the first command line for bash, truncated to 100 characters", () => {
    const longCommand = `${"x".repeat(120)}\nsecond line`
    const part = toolPart("bash", { input: { command: longCommand } })

    expect(getToolDescription(part, part.state, "/repo")).toBe("x".repeat(100))
  })

  test("counts questions for the question tool", () => {
    const single = toolPart("question", { input: { questions: [{ question: "q1" }] } })
    const multiple = toolPart("question", { input: { questions: [{ question: "q1" }, { question: "q2" }] } })

    expect(getToolDescription(single, single.state, "/repo")).toBe("Asked 1 question")
    expect(getToolDescription(multiple, multiple.state, "/repo")).toBe("Asked 2 questions")
  })

  test("truncates task descriptions to 80 characters", () => {
    const part = toolPart("task", { input: { description: "d".repeat(100) } })

    expect(getToolDescription(part, part.state, "/repo")).toBe("d".repeat(80))
  })

  test("falls back to input, metadata, then state title descriptions", () => {
    const fromInput = toolPart("grep", { input: { description: "from input" } })
    const fromMetadata = toolPart("grep", { metadata: { description: "from metadata" } })
    const fromTitle = toolPart("grep", { title: "from title" })
    const empty = toolPart("grep", {})

    expect(getToolDescription(fromInput, fromInput.state, "/repo")).toBe("from input")
    expect(getToolDescription(fromMetadata, fromMetadata.state, "/repo")).toBe("from metadata")
    expect(getToolDescription(fromTitle, fromTitle.state, "/repo")).toBe("from title")
    expect(getToolDescription(empty, empty.state, "/repo")).toBe("")
  })
})

describe("tool output text and language", () => {
  test("passes bash output through untouched", () => {
    const part = toolPart("bash")

    expect(getToolOutputText("raw output", part, undefined)).toBe("raw output")
    expect(getToolOutputLanguage("raw output", part, undefined, undefined)).toBe("bash")
  })
})
