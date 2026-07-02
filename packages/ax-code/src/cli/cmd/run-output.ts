import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

type JsonSchema = boolean | Record<string, unknown>
type RunOutputPartRecord = {
  type?: string
  text?: string
}
type RunOutputMessageRecord = {
  info?: {
    id?: string
    role?: string
  }
  parts?: RunOutputPartRecord[]
}

export type RunStructuredOutputOptions = {
  callerCwd: string
  outputFile?: string
  outputLastMessage?: string
  outputSchema?: string
}

export type SchemaValidationResult =
  | { ok: true }
  | {
      ok: false
      errors: string[]
    }

export function resolveRunOutputPath(callerCwd: string, target: string) {
  return path.isAbsolute(target) ? target : path.resolve(callerCwd, target)
}

export function resolveRunOutputFile(options: { outputFile?: string; outputLastMessage?: string }): string | undefined {
  if (!options.outputFile) return options.outputLastMessage
  if (!options.outputLastMessage || options.outputLastMessage === options.outputFile) return options.outputFile
  throw new Error("--output-file and --output-last-message must not point to different files")
}

export function extractRunFinalAssistantText(
  messages: readonly RunOutputMessageRecord[] | undefined,
  assistantMessageID: string | undefined,
): string | undefined {
  if (!assistantMessageID) return undefined
  const message = messages?.find((item) => item.info?.role === "assistant" && item.info.id === assistantMessageID)
  if (!message) return undefined
  for (let i = (message.parts?.length ?? 0) - 1; i >= 0; i--) {
    const part = message.parts?.[i]
    if (part?.type !== "text" || typeof part.text !== "string") continue
    const text = part.text.trim()
    if (text) return text
  }
}

export function parseFinalJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Final assistant message is not valid JSON: ${message}`)
  }
}

export async function loadJsonSchemaFile(callerCwd: string, file: string): Promise<JsonSchema> {
  const resolved = resolveRunOutputPath(callerCwd, file)
  let text: string
  try {
    text = await readFile(resolved, "utf8")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read output schema ${resolved}: ${message}`)
  }

  try {
    return JSON.parse(text) as JsonSchema
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse output schema ${resolved}: ${message}`)
  }
}

export async function writeRunOutputFile(callerCwd: string, target: string, content: string) {
  const resolved = resolveRunOutputPath(callerCwd, target)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, content)
}

export async function handleRunStructuredOutput(finalMessage: string | undefined, options: RunStructuredOutputOptions) {
  const outputFile = resolveRunOutputFile(options)
  if (!outputFile && !options.outputSchema) return

  const text = finalMessage?.trim()
  if (!text) throw new Error("No final assistant message was produced")

  if (options.outputSchema) {
    const schema = await loadJsonSchemaFile(options.callerCwd, options.outputSchema)
    const value = parseFinalJson(text)
    const result = validateJsonSchema(value, schema)
    if (!result.ok) {
      throw new Error(`Output schema validation failed: ${result.errors.join("; ")}`)
    }
  }

  if (outputFile) await writeRunOutputFile(options.callerCwd, outputFile, text)
}

export function validateJsonSchema(value: unknown, schema: JsonSchema): SchemaValidationResult {
  const errors: string[] = []
  validateAgainstSchema(value, schema, "$", errors)
  return errors.length ? { ok: false, errors } : { ok: true }
}

function validateAgainstSchema(value: unknown, schema: JsonSchema, location: string, errors: string[]) {
  if (schema === true) return
  if (schema === false) {
    errors.push(`${location} is disallowed by schema`)
    return
  }
  if (!isRecord(schema)) {
    errors.push(`${location} has an invalid schema`)
    return
  }

  validateComposition(value, schema, location, errors)
  validateEnumAndConst(value, schema, location, errors)
  validateType(value, schema, location, errors)

  if (isRecord(value)) validateObject(value, schema, location, errors)
  if (Array.isArray(value)) validateArray(value, schema, location, errors)
  if (typeof value === "string") validateString(value, schema, location, errors)
  if (typeof value === "number") validateNumber(value, schema, location, errors)
}

function validateComposition(value: unknown, schema: Record<string, unknown>, location: string, errors: string[]) {
  const allOf = schema.allOf
  if (Array.isArray(allOf)) {
    for (const item of allOf) validateAgainstSchema(value, normalizeSchema(item), location, errors)
  }

  const anyOf = schema.anyOf
  if (Array.isArray(anyOf) && !anyOf.some((item) => validateJsonSchema(value, normalizeSchema(item)).ok)) {
    errors.push(`${location} does not match any anyOf schema`)
  }

  const oneOf = schema.oneOf
  if (Array.isArray(oneOf)) {
    const matches = oneOf.filter((item) => validateJsonSchema(value, normalizeSchema(item)).ok).length
    if (matches !== 1) errors.push(`${location} matches ${matches} oneOf schemas, expected exactly 1`)
  }

  const notSchema = schema.not
  if (notSchema !== undefined && validateJsonSchema(value, normalizeSchema(notSchema)).ok) {
    errors.push(`${location} matches a forbidden not schema`)
  }
}

function validateEnumAndConst(value: unknown, schema: Record<string, unknown>, location: string, errors: string[]) {
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonEqual(value, item))) {
    errors.push(`${location} is not one of the allowed enum values`)
  }
  if ("const" in schema && !jsonEqual(value, schema.const)) {
    errors.push(`${location} does not match the required const value`)
  }
}

function validateType(value: unknown, schema: Record<string, unknown>, location: string, errors: string[]) {
  const expected = schema.type
  if (expected === undefined) return
  const allowed = Array.isArray(expected) ? expected : [expected]
  if (!allowed.every((item) => typeof item === "string")) return
  if (!allowed.some((item) => matchesType(value, item))) {
    errors.push(`${location} expected ${allowed.join("|")}, got ${jsonType(value)}`)
  }
}

function validateObject(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  location: string,
  errors: string[],
) {
  if (typeof schema.minProperties === "number" && Object.keys(value).length < schema.minProperties) {
    errors.push(`${location} has fewer than ${schema.minProperties} properties`)
  }
  if (typeof schema.maxProperties === "number" && Object.keys(value).length > schema.maxProperties) {
    errors.push(`${location} has more than ${schema.maxProperties} properties`)
  }

  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key === "string" && !(key in value)) errors.push(`${location}.${key} is required`)
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : undefined
  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in value) validateAgainstSchema(value[key], normalizeSchema(propSchema), `${location}.${key}`, errors)
    }
  }

  const additional = schema.additionalProperties
  if (additional === undefined || additional === true) return
  const known = new Set(properties ? Object.keys(properties) : [])
  for (const key of Object.keys(value)) {
    if (known.has(key)) continue
    if (additional === false) {
      errors.push(`${location}.${key} is not allowed`)
      continue
    }
    validateAgainstSchema(value[key], normalizeSchema(additional), `${location}.${key}`, errors)
  }
}

function validateArray(value: unknown[], schema: Record<string, unknown>, location: string, errors: string[]) {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    errors.push(`${location} has fewer than ${schema.minItems} items`)
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    errors.push(`${location} has more than ${schema.maxItems} items`)
  }
  if (schema.items === undefined) return
  const itemSchema = normalizeSchema(schema.items)
  value.forEach((item, index) => validateAgainstSchema(item, itemSchema, `${location}[${index}]`, errors))
}

function validateString(value: string, schema: Record<string, unknown>, location: string, errors: string[]) {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    errors.push(`${location} is shorter than ${schema.minLength}`)
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    errors.push(`${location} is longer than ${schema.maxLength}`)
  }
  if (typeof schema.pattern === "string") {
    try {
      if (!new RegExp(schema.pattern).test(value)) errors.push(`${location} does not match pattern ${schema.pattern}`)
    } catch {
      errors.push(`${location} has an invalid pattern constraint`)
    }
  }
}

function validateNumber(value: number, schema: Record<string, unknown>, location: string, errors: string[]) {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    errors.push(`${location} is less than ${schema.minimum}`)
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    errors.push(`${location} is greater than ${schema.maximum}`)
  }
}

function normalizeSchema(value: unknown): JsonSchema {
  return typeof value === "boolean" || isRecord(value) ? value : true
}

function matchesType(value: unknown, type: string) {
  switch (type) {
    case "array":
      return Array.isArray(value)
    case "boolean":
      return typeof value === "boolean"
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
    case "null":
      return value === null
    case "number":
      return typeof value === "number"
    case "object":
      return isRecord(value)
    case "string":
      return typeof value === "string"
    default:
      return true
  }
}

function jsonType(value: unknown) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => jsonEqual(item, right[index]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => key in right && jsonEqual(left[key], right[key]))
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
