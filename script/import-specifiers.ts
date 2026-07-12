import path from "node:path"
import ts from "typescript"

export type ImportSpecifier = {
  specifier: string
  line: number
  column: number
}

function scriptKind(file: string) {
  switch (path.extname(file).toLowerCase()) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS
    case ".jsx":
      return ts.ScriptKind.JSX
    case ".tsx":
      return ts.ScriptKind.TSX
    default:
      return ts.ScriptKind.TS
  }
}

/**
 * Extract statically knowable module specifiers without matching comments,
 * string contents, or other source text that merely resembles an import.
 */
export function extractImportSpecifiers(source: string, file = "source.ts"): ImportSpecifier[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  const specifiers: ImportSpecifier[] = []

  function add(node: ts.Expression | undefined) {
    if (!node || !ts.isStringLiteralLike(node)) return
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    specifiers.push({
      specifier: node.text,
      line: position.line + 1,
      column: position.character + 1,
    })
  }

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require"
      if (isDynamicImport || isRequire) add(node.arguments[0])
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}
