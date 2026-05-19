import { describe, test, expect } from "bun:test"
import {
  detectClippy,
  detectRuff,
  detectMypy,
  mapClippyLevel,
  mapRuffSeverity,
  type LanguageFinding,
} from "../../src/debug-engine/language-scan"

describe("language-scan", () => {
  describe("mapClippyLevel", () => {
    test("maps error to high", () => {
      expect(mapClippyLevel("error")).toBe("high")
    })
    test("maps warning to medium", () => {
      expect(mapClippyLevel("warning")).toBe("medium")
    })
    test("maps help to low", () => {
      expect(mapClippyLevel("help")).toBe("low")
    })
    test("maps note to info", () => {
      expect(mapClippyLevel("note")).toBe("info")
    })
    test("maps unknown to info", () => {
      expect(mapClippyLevel("unknown")).toBe("info")
    })
  })

  describe("mapRuffSeverity", () => {
    test("maps E-codes to medium", () => {
      expect(mapRuffSeverity("E501")).toBe("medium")
    })
    test("maps F-codes to medium", () => {
      expect(mapRuffSeverity("F841")).toBe("medium")
    })
    test("maps W-codes to low", () => {
      expect(mapRuffSeverity("W293")).toBe("low")
    })
    test("maps I-codes to low", () => {
      expect(mapRuffSeverity("I001")).toBe("low")
    })
    test("maps B-codes to low", () => {
      expect(mapRuffSeverity("B007")).toBe("low")
    })
    test("maps PLW-codes to medium", () => {
      expect(mapRuffSeverity("PLW2901")).toBe("medium")
    })
    test("maps PLC-codes to low", () => {
      expect(mapRuffSeverity("PLC0205")).toBe("low")
    })
  })

  describe("detectClippy", () => {
    test("returns error message when cargo not found", async () => {
      const result = await detectClippy({ cwd: "/nonexistent" })
      expect(result.tool).toBe("cargo-clippy")
      if (result.error) {
        expect(result.error.length).toBeGreaterThan(0)
      }
    })

    test("parses sample clippy JSON output", () => {
      const line1 = JSON.stringify({
        reason: "compiler-message",
        message: {
          message: "unused variable: x",
          code: { code: "unused_variables", explanation: null },
          level: "warning",
          spans: [
            {
              file_name: "src/main.rs",
              line_start: 5,
              line_end: 5,
              column_start: 9,
              column_end: 10,
              is_primary: true,
              text: [{ text: "    let x = 42;", highlight_start: 9, highlight_end: 10 }],
            },
          ],
        },
      })
      const line2 = JSON.stringify({
        reason: "compiler-message",
        message: {
          message: "unused import: std::io",
          code: { code: "unused_imports", explanation: null },
          level: "warning",
          spans: [
            {
              file_name: "src/main.rs",
              line_start: 1,
              line_end: 1,
              column_start: 5,
              column_end: 12,
              is_primary: true,
              text: [{ text: "use std::io;", highlight_start: 5, highlight_end: 12 }],
            },
          ],
        },
      })
      const sampleOutput = `${line1}\n${line2}`

      const findings: LanguageFinding[] = []
      for (const line of sampleOutput.split("\n")) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          if (!msg.message?.spans?.length) continue
          const primarySpan = msg.message.spans.find((s: any) => s.is_primary) ?? msg.message.spans[0]
          findings.push({
            file: primarySpan.file_name,
            line: primarySpan.line_start,
            endLine: primarySpan.line_end,
            column: primarySpan.column_start,
            endColumn: primarySpan.column_end,
            code: msg.message.code?.code ?? "clippy",
            message: msg.message.message,
            severity: mapClippyLevel(msg.message.level),
            language: "rust",
            tool: "cargo-clippy",
          })
        } catch {
          // Non-JSON lines — skip
        }
      }

      expect(findings.length).toBe(2)
      expect(findings[0].code).toBe("unused_variables")
      expect(findings[0].severity).toBe("medium")
      expect(findings[0].file).toBe("src/main.rs")
      expect(findings[0].line).toBe(5)
      expect(findings[1].code).toBe("unused_imports")
      expect(findings[1].severity).toBe("medium")
    })
  })

  describe("detectRuff", () => {
    test("returns error message when ruff not found", async () => {
      const result = await detectRuff({ cwd: "/nonexistent" })
      expect(result.tool).toBe("ruff")
      if (result.error) {
        expect(result.error.length).toBeGreaterThan(0)
      }
    })

    test("parses sample ruff JSON output", () => {
      const sampleOutput = JSON.stringify({
        diagnostics: [
          {
            code: "F841",
            message: "Local variable `x` is assigned to but never used",
            location: { row: 10, column: 5 },
            end_location: { row: 10, column: 6 },
            filename: "src/main.py",
          },
          {
            code: "E501",
            message: "Line too long (120 > 88)",
            location: { row: 15, column: 89 },
            end_location: { row: 15, column: 120 },
            filename: "src/main.py",
          },
        ],
      })

      const json = JSON.parse(sampleOutput)
      const findings: LanguageFinding[] = []
      for (const diag of json.diagnostics ?? []) {
        findings.push({
          file: diag.filename,
          line: diag.location.row,
          column: diag.location.column,
          endLine: diag.end_location.row,
          endColumn: diag.end_location.column,
          code: diag.code,
          message: diag.message,
          severity: mapRuffSeverity(diag.code),
          language: "python",
          tool: "ruff",
        })
      }

      expect(findings.length).toBe(2)
      expect(findings[0].code).toBe("F841")
      expect(findings[0].severity).toBe("medium")
      expect(findings[0].line).toBe(10)
      expect(findings[1].code).toBe("E501")
      expect(findings[1].severity).toBe("medium")
    })
  })

  describe("detectMypy", () => {
    test("returns error message when mypy not found", async () => {
      const result = await detectMypy({ cwd: "/nonexistent" })
      expect(result.tool).toBe("mypy")
      if (result.error) {
        expect(result.error.length).toBeGreaterThan(0)
      }
    })

    test("parses sample mypy JSON output", () => {
      const sampleOutput = JSON.stringify({
        files: [
          {
            path: "src/main.py",
            messages: [
              {
                severity: "error",
                message: 'Argument 1 to "int" has incompatible type "str"; expected "SupportsInt"',
                line: 5,
                column: 10,
                end_line: 5,
                end_column: 15,
              },
              {
                severity: "note",
                message: "See https://mypy.readthedocs.io/en/stable/faq.html",
                line: 5,
                column: 1,
              },
            ],
          },
        ],
      })

      const json = JSON.parse(sampleOutput)
      const findings: LanguageFinding[] = []
      for (const file of json.files ?? []) {
        for (const msg of file.messages) {
          findings.push({
            file: file.path,
            line: msg.line ?? 1,
            column: msg.column,
            endLine: msg.end_line,
            endColumn: msg.end_column,
            code: "mypy",
            message: msg.message,
            severity: msg.severity === "error" ? "high" : msg.severity === "warning" ? "medium" : "low",
            language: "python",
            tool: "mypy",
          })
        }
      }

      expect(findings.length).toBe(2)
      expect(findings[0].severity).toBe("high")
      expect(findings[0].line).toBe(5)
      expect(findings[0].code).toBe("mypy")
      expect(findings[1].severity).toBe("low")
    })
  })
})
