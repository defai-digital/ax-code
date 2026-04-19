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
const HOT_PATH_SINGLE_ROOT_SHOW_FILES = ["routes/home.tsx"]
const HOT_PATH_LAYOUT_PATTERNS = [
  { file: "routes/home.tsx", pattern: "minHeight=" },
  { file: "routes/home.tsx", pattern: "gap=" },
  { file: "routes/home.tsx", pattern: "padding=" },
  { file: "routes/home.tsx", pattern: "paddingTop=" },
  { file: "routes/home.tsx", pattern: "paddingBottom=" },
  { file: "routes/home.tsx", pattern: "paddingLeft=" },
  { file: "routes/home.tsx", pattern: "paddingRight=" },
]
const HOT_PATH_DYNAMIC_COPY_PATTERNS = [
  { file: "component/tips.tsx", pattern: "Math.random(" },
  { file: "component/tips.tsx", pattern: "<For" },
  { file: "component/tips.tsx", pattern: "flexWrap=" },
]
const HOT_PATH_SESSION_TEXT_PATTERNS = [
  { file: "routes/session/index.tsx", pattern: "<text fg={theme.text}>{lastUserText()}</text>" },
  { file: "routes/session/index.tsx", pattern: "<text fg={theme.textMuted}>Loading session...</text>" },
  { file: "routes/session/index.tsx", pattern: "<text fg={theme.textMuted}>Waiting for model...</text>" },
  { file: "routes/session/index.tsx", pattern: "<text marginTop={1} fg={footerColor()}>" },
  { file: "routes/session/index.tsx", pattern: "<text fg={theme.text}>{content()}</text>" },
  { file: "routes/session/index.tsx", pattern: "<text marginTop={1}>" },
  { file: "routes/session/index.tsx", pattern: "paddingLeft={3} marginTop={1} flexDirection=\"row\" gap={1}" },
  { file: "routes/session/index.tsx", pattern: "paddingLeft={2}\n        marginTop={1}" },
  { file: "routes/session/index.tsx", pattern: "paddingLeft={3} marginTop={1} flexShrink={0}" },
  { file: "routes/session/index.tsx", pattern: "const [margin, setMargin] = createSignal(0)" },
  { file: "routes/session/index.tsx", pattern: "renderBefore={function () {" },
]
const HOT_PATH_SCROLL_OBJECT_PATTERNS = [
  { file: "routes/session/index.tsx", pattern: "const scrollTrackOptions = createMemo(() => ({" },
  { file: "routes/session/index.tsx", pattern: "const scrollViewportOptions = createMemo(() => ({" },
  { file: "routes/session/index.tsx", pattern: "const verticalScrollbarOptions = createMemo(() => ({" },
  { file: "routes/session/sidebar.tsx", pattern: "const verticalScrollbarOptions = createMemo(() => ({" },
  { file: "routes/session/permission.tsx", pattern: "const verticalScrollbarOptions = createMemo(() => ({" },
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

function hotPathLayoutFindings(file: string) {
  const relative = relativeFile(file)
  const source = fs.readFileSync(file, "utf8")
  return HOT_PATH_LAYOUT_PATTERNS.flatMap((rule) => {
    if (rule.file !== relative) return []
    return source
      .split("\n")
      .flatMap((line, index) => (line.includes(rule.pattern) ? [`${relative}:${index + 1}:1 ${rule.pattern}`] : []))
  })
}

function hotPathDynamicCopyFindings(file: string) {
  const relative = relativeFile(file)
  const source = fs.readFileSync(file, "utf8")
  return HOT_PATH_DYNAMIC_COPY_PATTERNS.flatMap((rule) => {
    if (rule.file !== relative) return []
    return source
      .split("\n")
      .flatMap((line, index) => (line.includes(rule.pattern) ? [`${relative}:${index + 1}:1 ${rule.pattern}`] : []))
  })
}

function hotPathSessionTextFindings(file: string) {
  const relative = relativeFile(file)
  const source = fs.readFileSync(file, "utf8")
  return HOT_PATH_SESSION_TEXT_PATTERNS.flatMap((rule) => {
    if (rule.file !== relative) return []
    return source
      .split("\n")
      .flatMap((line, index) => (line.includes(rule.pattern) ? [`${relative}:${index + 1}:1 ${rule.pattern}`] : []))
  })
}

function hotPathScrollObjectFindings(file: string) {
  const relative = relativeFile(file)
  const source = fs.readFileSync(file, "utf8")
  return HOT_PATH_SCROLL_OBJECT_PATTERNS.flatMap((rule) => {
    if (rule.file !== relative) return []
    return source
      .split("\n")
      .flatMap((line, index) => (line.includes(rule.pattern) ? [`${relative}:${index + 1}:1 ${rule.pattern}`] : []))
  })
}

function hotPathMultiChildShowFindings(file: string) {
  const relative = relativeFile(file)
  if (!HOT_PATH_SINGLE_ROOT_SHOW_FILES.includes(relative)) return []
  const source = fs.readFileSync(file, "utf8")
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings: string[] = []

  function visit(node: ts.Node) {
    if (
      ts.isJsxElement(node) &&
      ts.isIdentifier(node.openingElement.tagName) &&
      node.openingElement.tagName.text === "Show"
    ) {
      const children = node.children.filter((child) => {
        if (ts.isJsxText(child)) return child.getFullText(sourceFile).trim().length > 0
        if (ts.isJsxExpression(child)) return child.getText(sourceFile).trim().length > 0
        return true
      })
      if (children.length > 1) {
        findings.push(`${location(sourceFile, node.getStart(sourceFile))} Show has ${children.length} root children`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
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

  test("does not use unstable layout props in the home startup hot path", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => hotPathLayoutFindings(file))
    expect(findings).toEqual([])
  })

  test("keeps startup tips on a static single-line render path", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => hotPathDynamicCopyFindings(file))
    expect(findings).toEqual([])
  })

  test("avoids reactive fg updates on the session first-render text path", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => hotPathSessionTextFindings(file))
    expect(findings).toEqual([])
  })

  test("keeps session scrollbox option objects stable on the hot path", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => hotPathScrollObjectFindings(file))
    expect(findings).toEqual([])
  })

  test("keeps Show branches to a single root node in the home startup hot path", () => {
    const findings = walkTSX(TUI_ROOT).flatMap((file) => hotPathMultiChildShowFindings(file))
    expect(findings).toEqual([])
  })
})
