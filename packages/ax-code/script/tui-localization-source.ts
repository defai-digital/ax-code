import ts from "typescript"

// These core entry points must never regain hardcoded menu copy. Other TUI
// surfaces are migrated independently; protocol IDs and raw evidence are not copy.
export const LOCALIZED_ENTRY_POINTS = [
  "src/cli/tui/app-commands.ts",
  "src/cli/tui/component/prompt/prompt-commands.tsx",
  "src/cli/tui/routes/session/display-commands.ts",
  "src/cli/tui/component/navigation-bar.tsx",
  "src/cli/tui/ui/dialog-help.tsx",
  "src/cli/tui/component/chrome-action.tsx",
  "src/cli/tui/component/session-navigation.tsx",
  "src/cli/tui/routes/session/sidebar.tsx",
] as const

const visibleProperties = new Set(["title", "description", "label", "placeholder", "emptyMessage", "category"])
const technicalLabels = new Set([
  "esc",
  "tab",
  "enter",
  "ctrl+c",
  "/sidebar",
  "/navigation",
  "/connect",
  "MCP",
  "AX",
  "Code",
  "W",
  "v",
])

export function untranslatedVisibleCopy(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const errors: string[] = []
  function report(node: ts.Node, value: string) {
    const normalized = value.replace(/\s+/g, " ").trim()
    if (!/[A-Za-z]/.test(normalized) || technicalLabels.has(normalized)) return
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    errors.push(`${file}:${line}: untranslated visible copy: ${normalized}`)
  }
  function expression(node: ts.Node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) report(node, node.text)
    else if (ts.isTemplateExpression(node)) {
      report(node.head, node.head.text)
      for (const span of node.templateSpans) report(span.literal, span.literal.text)
    } else if (ts.isConditionalExpression(node)) {
      expression(node.whenTrue)
      expression(node.whenFalse)
    } else if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) {
      if (node.expression) expression(node.expression)
    }
    // Calls, identifiers and condition operands are values, not literal copy.
  }
  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) report(node, node.text)
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) expression(node)
    if (ts.isPropertyAssignment(node) && visibleProperties.has(node.name.getText(source))) expression(node.initializer)
    if (ts.isJsxAttribute(node) && visibleProperties.has(node.name.getText(source)) && node.initializer)
      expression(node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return errors
}
