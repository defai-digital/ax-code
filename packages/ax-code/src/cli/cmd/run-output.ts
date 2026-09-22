import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { toErrorMessage } from "@/util/error-message"

type JsonSchema = boolean | Record<string, unknown>
type RunOutputPartRecord = {
  type?: string
  text?: string
}
type RunOutputMessageRecord = {
  info?: {
    id?: string
    role?: string
    tokens?: {
      input?: unknown
      output?: unknown
      reasoning?: unknown
      cache?: { read?: unknown; write?: unknown }
    }
  }
  parts?: RunOutputPartRecord[]
}

/** Terminal status of a headless `ax-code run`. */
export type RunResultStatus = "completed" | "blocked" | "error" | "timeout" | "cancelled"

/** Token counts reported on the terminal `result` event, flattened from `info.tokens`. */
export type RunUsageTotals = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** The last line of the run event stream: one record summarizing the whole run. */
export type RunResultEvent = {
  type: "result"
  timestamp: number
  sessionID: string
  status: RunResultStatus
  text: string
  permissionDenials: number
  usage?: RunUsageTotals
}

/** Machine-readable code carried by the structured early-error line on `exitEarly` paths. */
export type RunEarlyErrorCode = "usage" | "provider" | "model"

/** One stdout line emitted before the stderr prose when the run exits before submitting. */
export type RunEarlyErrorEvent = {
  type: "error"
  error: {
    code: RunEarlyErrorCode
    message: string
  }
}

export function buildRunResultEvent(input: {
  timestamp: number
  sessionID: string
  status: RunResultStatus
  text: string
  permissionDenials: number
  usage?: RunUsageTotals
}): RunResultEvent {
  // `usage` is omitted entirely when no token counts are available; a
  // present-but-empty usage object would be a wrong number.
  if (input.usage === undefined) {
    return {
      type: "result",
      timestamp: input.timestamp,
      sessionID: input.sessionID,
      status: input.status,
      text: input.text,
      permissionDenials: input.permissionDenials,
    }
  }
  return {
    type: "result",
    timestamp: input.timestamp,
    sessionID: input.sessionID,
    status: input.status,
    text: input.text,
    permissionDenials: input.permissionDenials,
    usage: input.usage,
  }
}

export function buildRunEarlyErrorEvent(code: RunEarlyErrorCode, message: string): RunEarlyErrorEvent {
  return { type: "error", error: { code, message } }
}

/**
 * Read token usage from the stored final assistant message. Returns undefined
 * when the message or its counts are missing or partial — the result event
 * then omits the `usage` key instead of reporting incomplete numbers.
 */
export function extractRunUsageTotals(
  messages: readonly RunOutputMessageRecord[] | undefined,
  assistantMessageID: string | undefined,
): RunUsageTotals | undefined {
  if (!assistantMessageID) return undefined
  const message = messages?.find((item) => item.info?.role === "assistant" && item.info.id === assistantMessageID)
  const tokens = message?.info?.tokens
  if (!tokens) return undefined
  const counts = [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write]
  if (counts.some((value) => typeof value !== "number" || !Number.isFinite(value))) return undefined
  return {
    input: tokens.input as number,
    output: tokens.output as number,
    reasoning: tokens.reasoning as number,
    cacheRead: tokens.cache?.read as number,
    cacheWrite: tokens.cache?.write as number,
  }
}

/** Tools whose successful completion counts as a mutation for the blocked-run rule. */
const RUN_MUTATING_TOOLS: ReadonlySet<string> = new Set(["write", "edit", "multiedit", "apply_patch", "bash"])

export function isRunMutatingToolCompletion(tool: string, status: string): boolean {
  return status === "completed" && RUN_MUTATING_TOOLS.has(tool)
}

/**
 * A tool error raised when the read-only sandbox denied a mutating tool call
 * (`session/prompt/prompt-tools.ts` throws `Tool denied in read-only mode:
 * <reason>`). It reaches the CLI as a tool error rather than a permission
 * ask, but represents the same blocked-run condition and feeds the same
 * denial counter.
 */
export function isRunReadOnlyToolDenial(state: { status: string; error?: string }): boolean {
  return (
    state.status === "error" && typeof state.error === "string" && /^Tool denied in read-only mode/.test(state.error)
  )
}

/**
 * A run is blocked when every permission ask was denied and none of the
 * denied mutations ever completed. A run that recovered (denied once, then
 * completed a mutation) is not blocked.
 */
export function isBlockedRun(permissionDenials: number, successfulMutations: number): boolean {
  return permissionDenials >= 1 && successfulMutations === 0
}

/**
 * True when an error is the abort error (`MessageAbortedError`) the server
 * emits in response to an abort this process requested itself — a `--timeout`
 * or a SIGINT. Those are the expected terminal outcomes (`timeout` /
 * `cancelled`), not failures; the run must not report them as an error. Every
 * other error — including a `MessageAbortedError` that arrives when neither
 * flag is set (someone else cancelled the session server-side) — is reported
 * as-is.
 */
export function isRunSelfAbortError(
  errorName: string | undefined,
  state: { timedOut: boolean; cancelled: boolean },
): boolean {
  return (state.timedOut || state.cancelled) && errorName === "MessageAbortedError"
}

export function resolveRunResultStatus(input: {
  failed: boolean
  blocked: boolean
  timedOut?: boolean
  cancelled?: boolean
}): RunResultStatus {
  if (input.failed) return "error"
  if (input.cancelled) return "cancelled"
  if (input.timedOut) return "timeout"
  if (input.blocked) return "blocked"
  return "completed"
}

export type RunStructuredOutputOptions = {
  callerCwd: string
  outputFile?: string
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
    throw new Error(`Final assistant message is not valid JSON: ${toErrorMessage(error)}`)
  }
}

export async function loadJsonSchemaFile(callerCwd: string, file: string): Promise<JsonSchema> {
  const resolved = resolveRunOutputPath(callerCwd, file)
  let text: string
  try {
    text = await readFile(resolved, "utf8")
  } catch (error) {
    throw new Error(`Failed to read output schema ${resolved}: ${toErrorMessage(error)}`)
  }

  try {
    return JSON.parse(text) as JsonSchema
  } catch (error) {
    throw new Error(`Failed to parse output schema ${resolved}: ${toErrorMessage(error)}`)
  }
}

export async function writeRunOutputFile(callerCwd: string, target: string, content: string) {
  const resolved = resolveRunOutputPath(callerCwd, target)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, content)
}

export async function handleRunStructuredOutput(finalMessage: string | undefined, options: RunStructuredOutputOptions) {
  if (!options.outputFile && !options.outputSchema) return

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

  if (options.outputFile) await writeRunOutputFile(options.callerCwd, options.outputFile, text)
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
