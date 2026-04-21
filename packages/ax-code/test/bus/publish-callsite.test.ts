import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import fg from "fast-glob"
import ts from "typescript"

const SRC_ROOT = path.resolve(import.meta.dir, "../../src")

function isBusPublish(node: ts.CallExpression) {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Bus" &&
    node.expression.name.text === "publish"
  )
}

function isAllowed(node: ts.CallExpression) {
  const parent = node.parent

  if (ts.isAwaitExpression(parent)) return true
  if (ts.isReturnStatement(parent)) return true
  if (ts.isArrowFunction(parent) && parent.body === node) return true

  return false
}

describe("Bus.publish callsite guardrail", () => {
  test("does not allow implicit fire-and-forget Bus.publish usage", async () => {
    const files = await fg(["**/*.ts", "**/*.tsx"], {
      cwd: SRC_ROOT,
      absolute: true,
      dot: false,
    })

    const offenders: string[] = []

    for (const file of files) {
      const sourceText = await fs.readFile(file, "utf8")
      const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && isBusPublish(node) && !isAllowed(node)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
          const snippet = sourceText.slice(node.getStart(source), node.getEnd()).replace(/\s+/g, " ")
          offenders.push(`${path.relative(SRC_ROOT, file)}:${line + 1} ${snippet}`)
        }
        ts.forEachChild(node, visit)
      }

      visit(source)
    }

    expect(
      offenders,
      [
        "Use `await Bus.publish(...)` when completion semantics matter.",
        "Use `Bus.publishDetached(...)` for eventual-consistency / observer-only paths.",
        "Raw non-awaited `Bus.publish(...)` reintroduces the ambiguous semantics that caused the hang cleanup.",
      ].join("\n"),
    ).toEqual([])
  })
})
