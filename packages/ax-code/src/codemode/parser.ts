import { parse, tokenizer, type AnyNode } from "acorn"
import { Budget, Fault } from "./limits"

const supported = new Set([
  "Program",
  "ExpressionStatement",
  "BlockStatement",
  "EmptyStatement",
  "Literal",
  "Identifier",
  "VariableDeclaration",
  "VariableDeclarator",
  "ArrayExpression",
  "ObjectExpression",
  "Property",
  "ArrayPattern",
  "ObjectPattern",
  "AssignmentPattern",
  "RestElement",
  "SpreadElement",
  "UnaryExpression",
  "UpdateExpression",
  "BinaryExpression",
  "LogicalExpression",
  "AssignmentExpression",
  "ConditionalExpression",
  "SequenceExpression",
  "MemberExpression",
  "ChainExpression",
  "CallExpression",
  "NewExpression",
  "TemplateLiteral",
  "TemplateElement",
  "IfStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
  "BreakStatement",
  "ContinueStatement",
  "ReturnStatement",
  "ThrowStatement",
  "TryStatement",
  "CatchClause",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "AwaitExpression",
  "ThisExpression",
])
export const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"])
export function unsupported(node: AnyNode, source: string, message: string = node.type): never {
  throw new Fault({
    error: "UnsupportedSyntax",
    message,
    line: node.loc?.start.line,
    column: node.loc?.start.column,
    excerpt: source.slice(node.start, Math.min(node.end, node.start + 100)),
  })
}
export function parseProgram(source: string, budget: Budget): AnyNode {
  if (Buffer.byteLength(source) > budget.limits.max_source_bytes) budget.fail("source_bytes")
  try {
    // Bound recursive parser work before acorn sees adversarial nesting. RegExp
    // tokens are refused without ever executing their patterns.
    let nesting = 0
    let tokens = 0
    for (const token of tokenizer(source, { ecmaVersion: 2022, locations: true })) {
      if (++tokens > budget.limits.max_steps) budget.fail("steps")
      if (["(", "[", "{", "${"].includes(token.type.label)) {
        if (++nesting > budget.limits.max_ast_depth) budget.fail("ast_depth")
      }
      if ([")", "]", "}"].includes(token.type.label)) nesting--
      if (token.type.label === "regexp")
        throw new Fault({
          error: "UnsupportedSyntax",
          message: "RegExp literals",
          line: token.loc?.start.line,
          column: token.loc?.start.column,
          excerpt: source.slice(token.start, token.start + 100),
        })
    }
    const program = parse(source, {
      ecmaVersion: 2022,
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    })
    const stack: { node: AnyNode; depth: number }[] = [{ node: program, depth: 1 }]
    while (stack.length) {
      const { node, depth } = stack.pop()!
      budget.step()
      if (depth > budget.limits.max_ast_depth) budget.fail("ast_depth")
      if (!supported.has(node.type)) unsupported(node, source)
      if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression") && node.generator)
        unsupported(node, source, "Generators")
      if (node.type === "Property" && node.kind !== "init") unsupported(node, source, "Getters and setters")
      if (node.type === "Literal" && (typeof node.value === "bigint" || node.regex))
        unsupported(node, source, "BigInt and RegExp")
      if (
        node.type === "NewExpression" &&
        (node.callee.type !== "Identifier" || !["Map", "Set", "Error", "Date"].includes(node.callee.name))
      )
        unsupported(node, source, "Only Map, Set, Error and Date constructors are supported")
      if (
        node.type === "MemberExpression" &&
        !node.computed &&
        node.property.type === "Identifier" &&
        forbiddenKeys.has(node.property.name)
      )
        unsupported(node, source, `Forbidden property: ${node.property.name}`)
      if (
        node.type === "MemberExpression" &&
        node.computed &&
        node.property.type === "Literal" &&
        forbiddenKeys.has(String(node.property.value))
      )
        unsupported(node, source, `Forbidden property: ${String(node.property.value)}`)
      if (node.type === "Property" && !node.computed) {
        const key =
          node.key.type === "Identifier" ? node.key.name : node.key.type === "Literal" ? String(node.key.value) : ""
        if (forbiddenKeys.has(key)) unsupported(node, source, `Forbidden property: ${key}`)
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const item of value)
            if (item && typeof item === "object" && "type" in item)
              stack.push({ node: item as AnyNode, depth: depth + 1 })
        } else if (value && typeof value === "object" && "type" in value)
          stack.push({ node: value as AnyNode, depth: depth + 1 })
      }
    }
    return program
  } catch (error) {
    if (error instanceof Fault) throw error
    if (error instanceof RangeError) budget.fail("ast_depth")
    const loc =
      error && typeof error === "object" && "loc" in error ? (error.loc as { line: number; column: number }) : undefined
    throw new Fault({
      error: "UnsupportedSyntax",
      message: error instanceof Error ? error.message : "Invalid program",
      line: loc?.line,
      column: loc?.column,
      excerpt: source.split("\n")[Math.max(0, (loc?.line ?? 1) - 1)]?.slice(0, 100),
    })
  }
}
