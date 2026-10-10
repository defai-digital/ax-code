import z from "zod"
import ts from "typescript"
import { isRecord } from "../util/record"
import { BrowserInventory } from "./inventory"

export namespace BrowserAuthoring {
  export const Parameters = z
    .object({
      action: z.literal("author"),
      name: z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/),
      description: z.string().min(10).max(1000),
      module: z.string().regex(/^\.\.?\/[\w./-]+$/),
      exportName: z
        .string()
        .regex(/^[A-Za-z_$][\w$]*$/)
        .max(100),
      schema: z.record(z.string(), z.unknown()),
      format: z.enum(["imperative", "declarative"]),
      effect: z.enum(["read", "change"]).default("change"),
      acceptsSignal: z.boolean().default(false),
    })
    .strict()
  export type Input = z.infer<typeof Parameters>

  export function hasExport(content: string, name: string) {
    const tree = ts.createSourceFile("app.ts", content, ts.ScriptTarget.Latest, true)
    if ((tree as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) return false
    return tree.statements.some((statement) => {
      if (
        !ts.canHaveModifiers(statement) ||
        !ts.getModifiers(statement)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
      )
        return false
      if (ts.isFunctionDeclaration(statement)) return statement.name?.text === name
      return (
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (item) =>
            ts.isIdentifier(item.name) &&
            item.name.text === name &&
            item.initializer &&
            (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer)),
        )
      )
    })
  }

  export function generate(input: Input) {
    boundedSchema(input)
    const quote = (value: unknown) => JSON.stringify(value, null, 2).replaceAll("<", "\\u003c")
    const call = `${input.exportName}(input${input.acceptsSignal ? ", { signal: executionSignal }" : ""})`
    const preface = `// Reuse application validation and authorization. Hints are not access controls.\nimport { ${input.exportName} } from ${quote(input.module)}\n`
    if (input.format === "imperative")
      return {
        javascript: `${preface}
// Call on mount with an AbortController signal; abort on unmount or when this operation is no longer available.
export async function registerWebMcpTool(lifecycleSignal) {
  if (typeof document.modelContext?.registerTool !== "function") return false
  await document.modelContext.registerTool({
    name: ${quote(input.name)},
    description: ${quote(input.description)},
    inputSchema: ${quote(input.schema)},
    annotations: { readOnlyHint: ${input.effect === "read"}, consequentialHint: ${input.effect === "change"}, untrustedContentHint: true },
    execute: async (input, { signal: executionSignal }) => {
      executionSignal.throwIfAborted()
      return ${call}
    },
  }, { signal: lifecycleSignal })
  return true
}
`,
        review:
          "Review input validation, authorization and actual effects in the application export. Cancellation reaches application work only when acceptsSignal is true and the application honors it.",
      }
    const escape = (value: string) =>
      value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    const properties = input.schema.properties as Record<string, Record<string, unknown>>
    const required = new Set(input.schema.required as string[] | undefined)
    const fields = Object.entries(properties)
      .map(([name, schema]) => {
        const label = typeof schema.description === "string" ? schema.description : name
        const attrs = `name="${escape(name)}"${required.has(name) && schema.type !== "boolean" ? " required" : ""}`
        if (Array.isArray(schema.enum))
          return `<label>${escape(label)}<select ${attrs}>${schema.enum.map((item) => `<option value="${escape(String(item))}">${escape(String(item))}</option>`).join("")}</select></label>`
        const type = schema.type === "boolean" ? "checkbox" : schema.type === "string" ? "text" : "number"
        const bounds = [
          typeof schema.minimum === "number" ? ` min="${schema.minimum}"` : "",
          typeof schema.maximum === "number" ? ` max="${schema.maximum}"` : "",
          typeof schema.maxLength === "number" ? ` maxlength="${schema.maxLength}"` : "",
          type === "number" ? ` step="${schema.type === "integer" ? "1" : "any"}"` : "",
        ].join("")
        return `<label>${escape(label)}<input type="${type}" ${attrs}${bounds}></label>`
      })
      .join("\n  ")
    return {
      html: `<form id="ax-webmcp-${escape(input.name)}" toolname="${escape(input.name)}" tooldescription="${escape(input.description)}">\n  ${fields}\n  <button type="submit">Submit</button>\n</form>`,
      javascript: `${preface}
const schema = ${quote(input.schema)}
// Install as a module. No toolautosubmit: the user submits the visible form.
export function bindWebMcpForm(lifecycleSignal) {
  const form = document.getElementById(${quote(`ax-webmcp-${input.name}`)})
  if (!(form instanceof HTMLFormElement)) throw new Error("WebMCP form unavailable")
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    if (!form.reportValidity()) return
    const executionSignal = lifecycleSignal
    const task = Promise.resolve().then(() => {
      executionSignal.throwIfAborted()
      const data = new FormData(form)
      const input = Object.fromEntries(Object.entries(schema.properties).flatMap(([name, field]) => {
        const raw = data.get(name)
        if (field.type === "boolean") return [[name, raw !== null]]
        if ((raw === null || raw === "") && !schema.required?.includes(name)) return []
        const value = field.type === "string" ? String(raw ?? "") : Number(raw)
        if (field.type !== "string" && !Number.isFinite(value)) throw new Error("Invalid numeric input")
        if (field.type === "integer" && !Number.isInteger(value)) throw new Error("Invalid integer input")
        return [[name, value]]
      }))
      return ${call}
    })
    if (event.agentInvoked) event.respondWith(task)
    // Application-owned UI handles both human and agent completion without swallowing errors.
    void task.then(
      (result) => form.dispatchEvent(new CustomEvent("webmcp-result", { detail: { result } })),
      () => form.dispatchEvent(new CustomEvent("webmcp-result", { detail: { error: "Application operation failed" } })),
    )
  }, { signal: lifecycleSignal })
}
`,
      review:
        "Integrate webmcp-result with the application's UI and review validation/authorization. Field edits may autosave in the surrounding application. Human submit is not a guarantee of no earlier effects.",
    }
  }

  function boundedSchema(input: Input) {
    BrowserInventory.bounded(input)
    const schema = input.schema
    if (schema.type !== "object" || !isRecord(schema.properties) || Object.keys(schema.properties).length > 16)
      throw new Error("Provide an explicit object schema with at most 16 properties")
    if (
      schema.required !== undefined &&
      (!Array.isArray(schema.required) ||
        schema.required.some((key) => typeof key !== "string" || !Object.hasOwn(schema.properties!, key)))
    )
      throw new Error("Required fields must name schema properties")
    if (input.format !== "declarative") return
    if (
      Object.keys(schema).some(
        (key) => !["type", "properties", "required", "additionalProperties", "description", "title"].includes(key),
      )
    )
      throw new Error("Declarative template does not support this object schema keyword")
    for (const [name, field] of Object.entries(schema.properties)) {
      if (
        !/^[A-Za-z][\w-]{0,99}$/.test(name) ||
        !isRecord(field) ||
        !["string", "number", "integer", "boolean"].includes(String(field.type)) ||
        Object.keys(field).some(
          (key) => !["type", "description", "title", "enum", "minimum", "maximum", "maxLength"].includes(key),
        )
      )
        throw new Error(
          "Declarative templates support named primitive fields only; use imperative registration for complex schemas",
        )
      if (
        field.enum !== undefined &&
        (!Array.isArray(field.enum) ||
          field.enum.length === 0 ||
          field.enum.length > 30 ||
          field.type !== "string" ||
          field.enum.some((item) => typeof item !== "string"))
      )
        throw new Error("Declarative enum must contain bounded string choices")
      for (const key of ["minimum", "maximum", "maxLength"])
        if (field[key] !== undefined && (typeof field[key] !== "number" || !Number.isFinite(field[key])))
          throw new Error("Declarative numeric constraints must be finite numbers")
      if (
        ((field.minimum !== undefined || field.maximum !== undefined) &&
          field.type !== "number" &&
          field.type !== "integer") ||
        (typeof field.minimum === "number" && typeof field.maximum === "number" && field.minimum > field.maximum) ||
        (field.maxLength !== undefined &&
          (field.type !== "string" || !Number.isInteger(field.maxLength) || (field.maxLength as number) < 0)) ||
        (field.enum !== undefined && field.maxLength !== undefined)
      )
        throw new Error("Declarative constraints cannot be represented faithfully by this form")
    }
  }
}
