import { describe, test, expect } from "bun:test"
import {
  decodeClippyJsonMessage,
  decodeMypyScanJson,
  decodeRuffScanJson,
  detectClippy,
  detectRuff,
  detectMypy,
  mapClippyLevel,
  mapRuffSeverity,
  parseClippyJsonLine,
  parseClippyOutput,
  parseMypyFilesJson,
  parseMypyOutput,
  parseRuffDiagnosticsJson,
  parseRuffOutput,
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
    test("decodeClippyJsonMessage decodes already-parsed compiler messages", () => {
      const decoded = decodeClippyJsonMessage({
        message: {
          message: "unused variable",
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
            },
          ],
        },
      })

      expect(decoded?.message).toBe("unused variable")
      expect(decodeClippyJsonMessage({ message: "missing spans", level: "warning" })).toBeUndefined()
    })

    test("parseClippyJsonLine decodes wrapped compiler messages", () => {
      const decoded = parseClippyJsonLine(
        `  ${JSON.stringify({
          reason: "compiler-message",
          message: {
            message: "unused variable",
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
              },
            ],
          },
        })}\n`,
      )

      expect(decoded?.message).toBe("unused variable")
      expect(decoded?.code?.code).toBe("unused_variables")
      expect(decoded?.spans[0]?.file_name).toBe("src/main.rs")
    })

    test("parseClippyJsonLine rejects malformed clippy JSON lines", () => {
      expect(parseClippyJsonLine("{not json")).toBeUndefined()
      expect(parseClippyJsonLine("")).toBeUndefined()
      expect(parseClippyJsonLine(JSON.stringify({ message: "missing spans", level: "warning" }))).toBeUndefined()
    })

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

      const { findings, filesScanned } = parseClippyOutput(sampleOutput)

      expect(findings.length).toBe(2)
      expect(filesScanned).toBe(1)
      expect(findings[0].code).toBe("unused_variables")
      expect(findings[0].severity).toBe("medium")
      expect(findings[0].file).toBe("src/main.rs")
      expect(findings[0].line).toBe(5)
      expect(findings[1].code).toBe("unused_imports")
      expect(findings[1].severity).toBe("medium")
    })

    test("parses flattened clippy JSON messages", () => {
      const sampleOutput = JSON.stringify({
        message: "dead code",
        code: { code: "dead_code", explanation: null },
        level: "warning",
        spans: [
          {
            file_name: "src/lib.rs",
            line_start: 9,
            line_end: 9,
            column_start: 1,
            column_end: 8,
            is_primary: true,
            text: [{ text: "fn dead() {}", highlight_start: 1, highlight_end: 8 }],
          },
        ],
      })

      const { findings, filesScanned } = parseClippyOutput(sampleOutput)
      expect(filesScanned).toBe(1)
      expect(findings).toHaveLength(1)
      expect(findings[0].code).toBe("dead_code")
      expect(findings[0].file).toBe("src/lib.rs")
    })

    test("skips malformed clippy JSON messages", () => {
      const valid = JSON.stringify({
        message: "dead code",
        code: { code: "dead_code", explanation: null },
        level: "warning",
        spans: [
          {
            file_name: "src/lib.rs",
            line_start: 9,
            line_end: 9,
            column_start: 1,
            column_end: 8,
            is_primary: true,
          },
        ],
      })
      const malformed = JSON.stringify({ message: "missing spans", level: "warning" })
      const { findings, filesScanned } = parseClippyOutput(`${malformed}\n${valid}`)

      expect(filesScanned).toBe(1)
      expect(findings).toHaveLength(1)
      expect(findings[0].code).toBe("dead_code")
    })
  })

  describe("detectRuff", () => {
    test("parseRuffDiagnosticsJson decodes object and array outputs", () => {
      const diagnostic = {
        code: "F401",
        message: "`os` imported but unused",
        location: { row: 2, column: 1 },
        filename: "src/imports.py",
      }

      expect(parseRuffDiagnosticsJson({ diagnostics: [diagnostic] })).toHaveLength(1)
      expect(parseRuffDiagnosticsJson([diagnostic])).toHaveLength(1)
    })

    test("parseRuffDiagnosticsJson filters malformed diagnostics", () => {
      expect(
        parseRuffDiagnosticsJson([
          {
            code: "F401",
            message: "`os` imported but unused",
            location: { row: 2, column: 1 },
            filename: "src/imports.py",
          },
          {
            code: "F841",
            message: "missing filename",
            location: { row: 10, column: 5 },
          },
        ]),
      ).toHaveLength(1)
      expect(parseRuffDiagnosticsJson({ diagnostics: "not an array" })).toEqual([])
    })

    test("decodeRuffScanJson decodes already-parsed scan output", () => {
      const { findings, filesScanned } = decodeRuffScanJson({
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

      expect(findings).toHaveLength(2)
      expect(filesScanned).toBe(1)
      expect(findings[0].code).toBe("F841")
      expect(findings[0].severity).toBe("medium")
      expect(findings[0].line).toBe(10)
      expect(findings[1].code).toBe("E501")
      expect(findings[1].severity).toBe("medium")
    })

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

      const { findings, filesScanned } = parseRuffOutput(sampleOutput)

      expect(findings.length).toBe(2)
      expect(filesScanned).toBe(1)
      expect(findings[0].code).toBe("F841")
      expect(findings[0].severity).toBe("medium")
      expect(findings[0].line).toBe(10)
      expect(findings[1].code).toBe("E501")
      expect(findings[1].severity).toBe("medium")
    })

    test("parses ruff JSON array output", () => {
      const sampleOutput = JSON.stringify([
        {
          code: "B007",
          message: "Loop control variable `item` not used within loop body",
          location: { row: 3, column: 5 },
          end_location: { row: 3, column: 9 },
          filename: "src/check.py",
        },
      ])

      const { findings, filesScanned } = parseRuffOutput(sampleOutput)

      expect(findings).toHaveLength(1)
      expect(filesScanned).toBe(1)
      expect(findings[0].code).toBe("B007")
      expect(findings[0].file).toBe("src/check.py")
      expect(findings[0].severity).toBe("low")
    })

    test("keeps ruff diagnostics that do not include a rule code", () => {
      const sampleOutput = JSON.stringify([
        {
          code: null,
          message: "failed to parse source file",
          location: { row: 1, column: 1 },
          end_location: { row: 1, column: 1 },
          filename: "src/broken.py",
        },
      ])

      const { findings, filesScanned } = parseRuffOutput(sampleOutput)

      expect(findings).toHaveLength(1)
      expect(filesScanned).toBe(1)
      expect(findings[0].code).toBe("ruff")
      expect(findings[0].severity).toBe("info")
    })

    test("falls back to the start location when ruff omits end_location", () => {
      const sampleOutput = JSON.stringify([
        {
          code: "F401",
          message: "`os` imported but unused",
          location: { row: 2, column: 1 },
          filename: "src/imports.py",
        },
      ])

      const { findings } = parseRuffOutput(sampleOutput)

      expect(findings).toHaveLength(1)
      expect(findings[0].line).toBe(2)
      expect(findings[0].column).toBe(1)
      expect(findings[0].endLine).toBe(2)
      expect(findings[0].endColumn).toBe(1)
    })

    test("skips malformed ruff diagnostics without dropping valid diagnostics", () => {
      const sampleOutput = JSON.stringify([
        {
          code: "F401",
          message: "`os` imported but unused",
          location: { row: 2, column: 1 },
          filename: "src/imports.py",
        },
        {
          code: "F841",
          message: "missing filename",
          location: { row: 10, column: 5 },
        },
      ])

      const { findings, filesScanned } = parseRuffOutput(sampleOutput)

      expect(findings).toHaveLength(1)
      expect(filesScanned).toBe(1)
      expect(findings[0].code).toBe("F401")
    })
  })

  describe("detectMypy", () => {
    test("parseMypyFilesJson decodes files and valid messages", () => {
      const decoded = parseMypyFilesJson({
        files: [
          {
            path: "src/main.py",
            messages: [
              {
                severity: "error",
                message: "bad type",
                line: 5,
              },
              {
                severity: "error",
                line: 6,
              },
            ],
          },
        ],
      })

      expect(decoded).toHaveLength(1)
      expect(decoded[0].path).toBe("src/main.py")
      expect(decoded[0].decodedMessages).toHaveLength(1)
      expect(decoded[0].decodedMessages[0]?.message).toBe("bad type")
    })

    test("parseMypyFilesJson filters malformed file entries", () => {
      expect(
        parseMypyFilesJson({
          files: [
            { path: "src/clean.py" },
            { messages: [{ severity: "error", message: "missing path" }] },
          ],
        }).map((file) => file.path),
      ).toEqual(["src/clean.py"])
      expect(parseMypyFilesJson({ files: "not an array" })).toEqual([])
    })

    test("decodeMypyScanJson decodes already-parsed scan output", () => {
      const { findings, filesScanned } = decodeMypyScanJson({
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

      expect(findings).toHaveLength(2)
      expect(filesScanned).toBe(1)
      expect(findings[0].severity).toBe("high")
      expect(findings[0].line).toBe(5)
      expect(findings[0].code).toBe("mypy")
      expect(findings[1].severity).toBe("low")
    })

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

      const { findings, filesScanned } = parseMypyOutput(sampleOutput)

      expect(findings.length).toBe(2)
      expect(filesScanned).toBe(1)
      expect(findings[0].severity).toBe("high")
      expect(findings[0].line).toBe(5)
      expect(findings[0].code).toBe("mypy")
      expect(findings[1].severity).toBe("low")
    })

    test("counts mypy file entries without messages", () => {
      const sampleOutput = JSON.stringify({
        files: [{ path: "src/clean.py" }],
      })

      const { findings, filesScanned } = parseMypyOutput(sampleOutput)

      expect(findings).toHaveLength(0)
      expect(filesScanned).toBe(1)
    })

    test("skips malformed mypy files and messages without dropping valid entries", () => {
      const sampleOutput = JSON.stringify({
        files: [
          {
            path: "src/main.py",
            messages: [
              {
                severity: "error",
                message: "bad type",
                line: 5,
              },
              {
                severity: "error",
                line: 6,
              },
            ],
          },
          {
            messages: [{ severity: "error", message: "missing path" }],
          },
        ],
      })

      const { findings, filesScanned } = parseMypyOutput(sampleOutput)

      expect(filesScanned).toBe(1)
      expect(findings).toHaveLength(1)
      expect(findings[0].file).toBe("src/main.py")
      expect(findings[0].message).toBe("bad type")
    })
  })
})
