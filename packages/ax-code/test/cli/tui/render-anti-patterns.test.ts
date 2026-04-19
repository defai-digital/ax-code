import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import ts from "typescript"

const TUI_ROOT = path.resolve(import.meta.dir, "../../../src/cli/cmd/tui")
const REACTIVE_PRIMITIVES = new Set(["createMemo", "createSignal", "createEffect", "onMount"])
const INLINE_SCROLLBAR_OPTION_PATTERNS = ["scrollbarOptions={{", "verticalScrollbarOptions={{", "viewportOptions={{"]
const HOT_PATH_INLINE_SPAN_FILES = [
  "component/prompt/index.tsx",
  "component/tips.tsx",
  "routes/home.tsx",
  "routes/session/footer.tsx",
  "routes/session/header.tsx",
  "routes/session/index.tsx",
]

function walkTSX(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) walkTSX(file, out)
    else if (file.endsWith(".tsx")) out.push(file)
  }
  return out.sort()
}

function relativeFile(file: string) {
  return path.relative(TUI_ROOT, file)
}

function location(sourceFile: ts.SourceFile, position: number) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position)
  return `${relativeFile(sourceFile.fileName)}:${line + 1}:${character + 1}`
}

function nearestEnclosingFunction(node: ts.Node) {
  let current = node.parent
  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current)) {
      return current
    }
    current = current.parent
  }
}

function isInsideJsxExpression(node: ts.Node) {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isJsxExpression(current)) return true
    if (ts.isSourceFile(current)) return false
    current = current.parent
  }
  return false
}

function jsxReactivePrimitiveFindings(file: string) {
  const source = fs.readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings: string[] = []

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      REACTIVE_PRIMITIVES.has(node.expression.text)
    ) {
      const enclosing = nearestEnclosingFunction(node)
      if (enclosing && isInsideJsxExpression(enclosing)) {
        findings.push(`${location(sourceFile, node.getStart(sourceFile))} ${node.expression.text}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

function inlineScrollbarOptionFindings(file: string) {
  const findings: string[] = []
  const source = fs.readFileSync(file, "utf8")
  const lines = source.split("\n")

  for (const pattern of INLINE_SCROLLBAR_OPTION_PATTERNS) {
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]!.includes(pattern)) continue
      findings.push(`${relativeFile(file)}:${index + 1}:1 ${pattern}`)
    }
  }

  return findings
}

function hotPathInlineSpanFindings(file: string) {
  const relative = relativeFile(file)
  if (!HOT_PATH_INLINE_SPAN_FILES.includes(relative)) return []
  const findings: string[] = []
  const lines = fs.readFileSync(file, "utf8").split("\n")

  for (let index = 0; index < lines.length; index++) {
    if (!lines[index]!.includes("<span")) continue
    findings.push(`${relative}:${index + 1}:1 <span`)
  }

  return findings
}

describe("tui render anti-patterns", () => {
  test("does not create reactive primitives inside JSX callbacks", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => jsxReactivePrimitiveFindings(file))
    expect(findings).toEqual([])
  })

  test("does not pass inline scrollbar option objects", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => inlineScrollbarOptionFindings(file))
    expect(findings).toEqual([])
  })

  test("does not use inline spans in startup/session hot paths", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => hotPathInlineSpanFindings(file))
    expect(findings).toEqual([])
  })
})
