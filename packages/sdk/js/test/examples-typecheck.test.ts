import { resolve } from "node:path"
import ts from "typescript"
import { describe, expect, test } from "vitest"

const PACKAGE_ROOT = resolve(import.meta.dirname, "..")
const CONFIG_PATH = resolve(PACKAGE_ROOT, "tsconfig.examples.json")

/** Format a compiler diagnostic as `file:line:column - error TS<code>: message`. */
function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  if (!diagnostic.file || diagnostic.start === undefined) return `error TS${diagnostic.code}: ${message}`
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${diagnostic.file.fileName}:${line + 1}:${character + 1} - error TS${diagnostic.code}: ${message}`
}

describe("examples typecheck", () => {
  test("tsconfig.examples.json type-checks with zero diagnostics", () => {
    const configFile = ts.readConfigFile(CONFIG_PATH, ts.sys.readFile)
    if (configFile.error) throw new Error(formatDiagnostic(configFile.error))

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, PACKAGE_ROOT, undefined, CONFIG_PATH)
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.map(formatDiagnostic).join("\n"))
    }

    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    expect(diagnostics.map(formatDiagnostic)).toEqual([])
  })
})
