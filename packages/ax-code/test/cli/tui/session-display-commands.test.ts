import { describe, expect, test } from "vitest"
import path from "node:path"
import {
  COMPACT_KEEP_MAX,
  parseCompactArgs,
  renderCompactPreview,
  resolveTranscriptExportPath,
  transcriptFilename,
} from "../../../src/cli/tui/routes/session/display-command-helpers"

describe("tui session display command helpers", () => {
  test("builds transcript export filename from session id", () => {
    expect(transcriptFilename("abcdef123456")).toBe("session-abcdef12.md")
  })

  test("resolves export filenames whose first segment starts with dots", () => {
    expect(resolveTranscriptExportPath("..exports/session.md")).toBe(
      path.join(process.cwd(), "..exports", "session.md"),
    )
  })

  test("rejects export filenames outside the workspace", () => {
    expect(() => resolveTranscriptExportPath("../session.md")).toThrow("Export filename must stay inside")
    expect(() => resolveTranscriptExportPath(path.join(path.sep, "tmp", "session.md"))).toThrow(
      "Export filename must be relative",
    )
  })
})

describe("parseCompactArgs (ADR-225)", () => {
  test("a bare command keeps today's behaviour (no keep, no preview, no focus)", () => {
    expect(parseCompactArgs("")).toEqual({ preview: false })
    expect(parseCompactArgs("   ")).toEqual({ preview: false })
  })

  test("a plain focus is preserved", () => {
    expect(parseCompactArgs("keep the API migration notes")).toEqual({
      preview: false,
      focus: "keep the API migration notes",
    })
  })

  test("--keep takes the following number and clamps it to 1..COMPACT_KEEP_MAX", () => {
    expect(parseCompactArgs("--keep 5")).toEqual({ preview: false, keep: 5 })
    expect(parseCompactArgs("--keep=12")).toEqual({ preview: false, keep: 12 })
    expect(parseCompactArgs("--keep 0").keep).toBe(1)
    expect(parseCompactArgs("--keep 999").keep).toBe(COMPACT_KEEP_MAX)
  })

  test("a non-numeric --keep is dropped instead of failing the command", () => {
    // The flag is consumed; the non-numeric token falls through as focus text
    // rather than throwing, so a stray `--keep` never blocks `/compact`.
    expect(parseCompactArgs("--keep nope")).toEqual({ preview: false, focus: "nope" })
    expect(parseCompactArgs("--keep nope keep tests")).toEqual({ preview: false, focus: "nope keep tests" })
    expect(parseCompactArgs("--keep").keep).toBeUndefined()
  })

  test("--preview and --keep combine and may appear anywhere around the focus", () => {
    expect(parseCompactArgs("--keep 3 --preview keep the tests")).toEqual({
      preview: true,
      keep: 3,
      focus: "keep the tests",
    })
    expect(parseCompactArgs("keep the tests --preview")).toEqual({ preview: true, focus: "keep the tests" })
  })

  test("caps the focus at the ADR-215 limit of 500 characters", () => {
    const parsed = parseCompactArgs(`--preview ${"a".repeat(600)}`)
    expect(parsed.focus).toHaveLength(500)
  })
})

describe("renderCompactPreview (ADR-225)", () => {
  test("renders counts, pruned tools and the focus", () => {
    const text = renderCompactPreview({
      summarizeMessages: 42,
      summarizeTokens: 12345,
      keepMessages: 5,
      keepTokens: 800,
      prunedToolOutputs: [{ tool: "bash", parts: 3, estimatedTokens: 900 }],
      focus: "keep the API notes",
    })
    expect(text).toContain("Messages to summarize: 42 (~12345 tokens)")
    expect(text).toContain("Messages kept verbatim: 5 (~800 tokens)")
    expect(text).toContain("bash x3 (~900 tokens)")
    expect(text).toContain("keep the API notes")
  })

  test("discloses no pruning and no focus when absent", () => {
    const text = renderCompactPreview({
      summarizeMessages: 1,
      summarizeTokens: 2,
      keepMessages: 0,
      keepTokens: 0,
      prunedToolOutputs: [],
      focus: "",
    })
    expect(text).toContain("Tool outputs pruned from the summary: none")
    expect(text).toContain("Focus: none")
  })
})
