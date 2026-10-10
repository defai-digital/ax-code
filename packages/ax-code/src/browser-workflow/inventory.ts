import path from "node:path"
import ts from "typescript"
import z from "zod"
import { WebMcpProfile } from "../mcp/webmcp-profile"
import { isRecord } from "../util/record"
import { BrowserScenario } from "./scenario"
import { readLocalSource } from "./diagnostics"

export namespace BrowserInventory {
  export const SourceFiles = z
    .array(
      z
        .string()
        .min(1)
        .max(512)
        .refine(
          (file) =>
            !path.isAbsolute(file) &&
            !file.includes(":") &&
            !file.includes("\\") &&
            !file.split("/").some((part) => part === ".." || part === "node_modules" || part === ".git"),
          "Use repository-relative application source files",
        ),
    )
    .max(16)
    .default([])
  export type Descriptor = WebMcpProfile.ToolDescriptor
  export type Candidate = {
    file: string
    line: number
    name?: string
    kind: "imperative" | "declarative"
    schema?: unknown
    sourceHash: string
  }

  /** Bound every value before recursive canonicalization or retaining it in session memory. */
  export function bounded(value: unknown, maxBytes = 32768): void {
    const stack = [{ value, depth: 0 }]
    let count = 0
    while (stack.length) {
      const entry = stack.pop()!
      if (++count > 10000 || entry.depth > 16) throw new Error("Browser workflow data exceeds nesting limits")
      if (entry.value && typeof entry.value === "object")
        for (const child of Object.values(entry.value)) stack.push({ value: child, depth: entry.depth + 1 })
    }
    const json = JSON.stringify(value)
    if (json === undefined || Buffer.byteLength(json) > maxBytes)
      throw new Error("Browser workflow data exceeds byte limit")
    if (WebMcpProfile.credentialLike(json)) throw new Error("Credentials are not allowed in browser workflow data")
  }

  export function listing(value: unknown): Descriptor[] {
    const descriptors = WebMcpProfile.parseToolListing(value)
    if (
      !descriptors ||
      descriptors.length > WebMcpProfile.MAX_TOOLS ||
      new Set(descriptors.map((item) => item.name)).size !== descriptors.length
    )
      throw new Error("Complete unambiguous page-tool inventory unavailable")
    bounded(descriptors, WebMcpProfile.MAX_DESCRIPTOR_BYTES)
    return descriptors
  }

  export function diff(before: Descriptor[], after: Descriptor[]) {
    const old = new Map(before.map((item) => [item.name, item]))
    const current = new Map(after.map((item) => [item.name, item]))
    const changes: Array<{ name: string; kind: "added" | "removed" | "changed"; fields: string[] }> = []
    const fields = (a: unknown, b: unknown, prefix: string): string[] => {
      if (BrowserScenario.canonical(a) === BrowserScenario.canonical(b)) return []
      if (isRecord(a) && isRecord(b))
        return [...new Set([...Object.keys(a), ...Object.keys(b)])]
          .sort()
          .flatMap((key) => fields(a[key], b[key], `${prefix}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`))
      return [prefix || "/"]
    }
    for (const name of [...new Set([...old.keys(), ...current.keys()])].sort()) {
      if (!old.has(name)) changes.push({ name, kind: "added", fields: [] })
      else if (!current.has(name)) changes.push({ name, kind: "removed", fields: [] })
      else {
        const changed = fields(old.get(name), current.get(name), "")
        if (changed.length) changes.push({ name, kind: "changed", fields: changed })
      }
    }
    return changes
  }

  function literal(node: ts.Expression, depth = 0): unknown {
    if (depth > 16) return undefined
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isArrayLiteralExpression(node)) {
      const items = node.elements.map((item) => literal(item, depth + 1))
      return items.some((item) => item === undefined) ? undefined : items
    }
    if (ts.isObjectLiteralExpression(node)) {
      const entries: Array<[string, unknown]> = []
      for (const item of node.properties) {
        if (!ts.isPropertyAssignment(item) || ts.isComputedPropertyName(item.name)) return undefined
        const value = literal(item.initializer, depth + 1)
        if (value === undefined) return undefined
        entries.push([item.name.text, value])
      }
      return Object.fromEntries(entries)
    }
    return undefined
  }

  export async function sources(
    root: string,
    files: string[],
    descriptors: Descriptor[],
    allow: (file: string) => Promise<void>,
  ) {
    const candidates: Candidate[] = []
    const unresolved: Array<{ file: string; reason: string }> = []
    let bytes = 0
    for (const file of SourceFiles.parse(files)) {
      // Permission failures propagate. Unreadable or oversized files never silently disappear.
      const source = await readLocalSource(root, file, allow)
      bytes += Buffer.byteLength(source.content)
      if (bytes > 2 * 1024 * 1024) throw new Error("Source inventory exceeds total byte limit")
      if (/\.html?$/.test(file)) {
        const clean = source.content.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "))
        for (const match of clean.matchAll(/<form\b[^>]*\btoolname\s*=\s*(["'])([^"']+)\1[^>]*>/gi)) {
          candidates.push({
            file: source.file,
            line: clean.slice(0, match.index).split("\n").length,
            name: match[2],
            kind: "declarative",
            sourceHash: source.hash,
          })
        }
        // Embedded scripts and dynamic template attributes are not asserted to be absent.
        unresolved.push({
          file,
          reason: "Only static quoted HTML form attributes inspected; scripts and dynamic templates require review",
        })
      } else {
        const tree = ts.createSourceFile(
          file,
          source.content,
          ts.ScriptTarget.Latest,
          true,
          /\.[jt]sx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        )
        // Parser recovery can produce plausible partial nodes; never present those as mappings.
        if ((tree as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) {
          unresolved.push({ file, reason: "Source syntax could not be parsed" })
          continue
        }
        const visit = (node: ts.Node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "registerTool"
          ) {
            const arg = node.arguments[0]
            const props: readonly ts.ObjectLiteralElementLike[] =
              arg && ts.isObjectLiteralExpression(arg) ? arg.properties : []
            const property = (name: string) =>
              props.find(
                (item): item is ts.PropertyAssignment =>
                  ts.isPropertyAssignment(item) && !ts.isComputedPropertyName(item.name) && item.name.text === name,
              )
            const name = property("name")
            const schema = property("inputSchema")
            const value = name ? literal(name.initializer) : undefined
            candidates.push({
              file: source.file,
              line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              name: typeof value === "string" ? value : undefined,
              kind: "imperative",
              schema: schema ? literal(schema.initializer) : undefined,
              sourceHash: source.hash,
            })
          }
          ts.forEachChild(node, visit)
        }
        visit(tree)
      }
      if (candidates.length > 200) throw new Error("Too many source registration candidates")
    }
    return {
      mappings: descriptors.map((descriptor) => {
        const matches = candidates.filter((entry) => entry.name === descriptor.name)
        return {
          name: descriptor.name,
          confidence:
            matches.length > 1
              ? "ambiguous"
              : matches.length === 0
                ? "unresolved"
                : matches[0]!.schema !== undefined &&
                    BrowserScenario.canonical(matches[0]!.schema) === BrowserScenario.canonical(descriptor.inputSchema)
                  ? "name_and_schema_candidate"
                  : "name_only_candidate",
          candidates: matches.map(({ schema: _schema, ...entry }) => entry),
        }
      }),
      dynamic: candidates.filter((entry) => !entry.name).map(({ schema: _schema, ...entry }) => entry),
      unresolved,
    }
  }
}
