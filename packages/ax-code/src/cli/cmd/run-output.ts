import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { NamedError } from "@ax-code/util/error"
import { toErrorMessage } from "@/util/error-message"
import { parseJsonResult } from "@/util/json-value"

type JsonSchema = boolean | Record<string, unknown>
type RunOutputPartRecord = {
  type?: string
  text?: string
}
type RunOutputMessageRecord = {
  info?: {
    id?: string
    role?: string
    /** Server-captured structured result, set when the run steered through the StructuredOutput tool. */
    structured?: unknown
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

/**
 * Machine-readable code carried by the structured early-error line on `exitEarly`
 * paths. `usage`/`provider`/`model` cover flag and routing mistakes caught before
 * any request; `session` is a missing or rejected session id; `attach` is a
 * failure to reach the ax-code server; `internal` converts any otherwise
 * unstructured rejection.
 */
export type RunEarlyErrorCode = "usage" | "provider" | "model" | "session" | "attach" | "internal"

/** One stdout line emitted before the stderr prose when the run exits before submitting. */
export type RunEarlyErrorEvent = {
  type: "error"
  error: {
    code: RunEarlyErrorCode
    message: string
  }
}

/** The structured classification of an otherwise-unhandled run rejection. */
export type RunFailureClassification = {
  code: RunEarlyErrorCode
  message: string
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

/** Extract `.name` from an unknown error (a rejected HTTP body or a thrown error). */
function errorNameOfRecord(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined
  const name = (error as { name?: unknown }).name
  return typeof name === "string" ? name : undefined
}

/**
 * Connection-failure signals from an SDK call. undici wraps the OS socket
 * error (ECONNREFUSED/ENOTFOUND) as the `cause` of a `TypeError: fetch
 * failed`; direct socket errors carry the code themselves. The cause chain is
 * walked because some runtimes nest it another level (e.g. AggregateError).
 */
function isRunConnectionFailure(error: unknown, seen: Set<object> = new Set()): boolean {
  if (typeof error !== "object" || error === null || seen.has(error)) return false
  seen.add(error)
  const record = error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown }
  if (record.code === "ECONNREFUSED" || record.code === "ENOTFOUND") return true
  if (record.name === "TypeError" && typeof record.message === "string" && record.message.includes("fetch failed")) {
    return true
  }
  return isRunConnectionFailure(record.cause, seen)
}

/**
 * The most detailed message in the cause chain — typically
 * "connect ECONNREFUSED 127.0.0.1:4096" rather than the generic
 * "fetch failed" TypeError that wraps it.
 */
function describeRunConnectionFailure(error: unknown): string {
  const messages: string[] = []
  const seen = new Set<object>()
  let current: unknown = error
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current)
    const message = NamedError.message(current).trim()
    if (message.length > 0) messages.push(message)
    const cause = (current as { cause?: unknown }).cause
    if (cause === undefined || cause === null) break
    current = cause
  }
  const detailed = messages.filter((message) => message !== "fetch failed")
  return detailed[detailed.length - 1] ?? messages[messages.length - 1] ?? "connection failed"
}

/**
 * Whether an otherwise-unhandled rejection is an HTTP 401/403 from the
 * attached server. A managed runtime requires the `x-ax-code-runtime-token`
 * header and answers `403 {"name":"ForbiddenError",...}` (or the server's
 * `{name:"InvalidRequestError", status: 403}` envelope) with the message
 * "Runtime authorization required" when it is missing, so the classifier keys
 * on that message string or the 401/403 status rather than the `name` field.
 */
export function isRunAuthFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const record = error as { status?: unknown; data?: { statusCode?: unknown } | null }
  if (record.status === 401 || record.status === 403) return true
  if (record.data?.statusCode === 401 || record.data?.statusCode === 403) return true
  // Auth rejections arrive as deserialized HTTP bodies (plain records), never as
  // real Error instances. Exclude Error here so a thrown Error that happens to
  // carry the same wording is not mistaken for an auth rejection.
  if (error instanceof Error) return false
  return NamedError.message(error) === "Runtime authorization required"
}

/** Whether an error is the local-only loopback-policy rejection from `assertLoopbackHttpUrl`. */
function isLoopbackPolicyRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes("must use a loopback address")
}

/**
 * Map an otherwise-unhandled run rejection to the structured early-error
 * shape: a deserialized `SessionNotFoundError` body is a session failure, an
 * HTTP 401/403 auth rejection or a fetch/socket failure is an attach failure,
 * the loopback-policy rejection is a usage error, everything else is internal
 * with the most readable message available (`NamedError.message`, never
 * "[object Object]").
 */
export function classifyRunFailure(error: unknown): RunFailureClassification {
  if (errorNameOfRecord(error) === "SessionNotFoundError") {
    return { code: "session", message: NamedError.message(error) }
  }
  if (isRunAuthFailure(error)) {
    return { code: "attach", message: NamedError.message(error) }
  }
  if (isLoopbackPolicyRejection(error)) {
    return { code: "usage", message: NamedError.message(error) }
  }
  if (isRunConnectionFailure(error)) {
    return { code: "attach", message: describeRunConnectionFailure(error) }
  }
  return { code: "internal", message: NamedError.message(error) }
}

/** File-extension mime mapping for `run --file` attachments. */
const RUN_FILE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

/**
 * Mime type for a `run --file` attachment inferred from its filename:
 * images and PDFs keep their binary type, everything else is text/plain.
 * Directories are classified by the caller (application/x-directory).
 */
export function runFileMime(filename: string): string {
  const dot = filename.lastIndexOf(".")
  const extension = dot === -1 ? "" : filename.slice(dot + 1).toLowerCase()
  if (extension === "pdf") return "application/pdf"
  return RUN_FILE_MIME_BY_EXTENSION[extension] ?? "text/plain"
}

export type RunOutputSchemaPreflight = { ok: true; schema: Record<string, unknown> } | { ok: false; message: string }

/**
 * Pre-submission check for `--output-schema`: the file must be readable, valid
 * JSON, and an object. Returns a usage-error message on failure so the run can
 * exit early instead of wasting a full generation before the post-run
 * validation rejects. On success the parsed schema object is returned so the
 * same value can steer the model (prompt body `format`); the post-run
 * validation itself stays unchanged as the backstop.
 */
export async function preflightRunOutputSchema(callerCwd: string, file: string): Promise<RunOutputSchemaPreflight> {
  const resolved = resolveRunOutputPath(callerCwd, file)
  let text: string
  try {
    text = await readFile(resolved, "utf8")
  } catch (error) {
    return { ok: false, message: `Failed to read output schema ${file}: ${toErrorMessage(error)}` }
  }
  const parsed = parseJsonResult(text)
  if (!parsed.ok) {
    return { ok: false, message: `Failed to parse output schema ${file}: ${toErrorMessage(parsed.error)}` }
  }
  if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
    return { ok: false, message: `Output schema ${file} must be a JSON object` }
  }
  return { ok: true, schema: parsed.value as Record<string, unknown> }
}

/**
 * Built-in tool ids derived from the tool source files in `src/tool/`
 * (`ls.ts` serves the `list` id, `todo.ts` serves todowrite/todoread).
 * `--disallowed-tools` ids outside this set are not an error — MCP tool ids
 * are dynamic — but the CLI warns on them in the default format.
 */
export const RUN_BUILTIN_TOOL_IDS: ReadonlySet<string> = new Set([
  "bash",
  "read",
  "write",
  "edit",
  "multiedit",
  "apply_patch",
  "glob",
  "grep",
  "list",
  "webfetch",
  "websearch",
  "task",
  "todowrite",
  "todoread",
  "question",
  "skill",
])

/**
 * Parse repeatable `--disallowed-tools` values: each entry may carry one id or
 * a comma-separated list. Whitespace-only entries are ignored; the result maps
 * every distinct id to `false` for the prompt body's `tools` field.
 */
export function parseDisallowedTools(values: readonly string[]): Record<string, false> {
  const tools: Record<string, false> = {}
  for (const value of values) {
    for (const entry of value.split(",")) {
      const id = entry.trim()
      if (id.length > 0) tools[id] = false
    }
  }
  return tools
}

/**
 * Permission rules for `--add-dir`: one `external_directory` allow rule per
 * resolved directory. Tools ask for that permission with a `<dir>/*` glob
 * (`tool/external-directory.ts`, `tool/bash-impl.ts`) and the wildcard matcher
 * treats `*` as `.*` crossing `/`, so a single `<dir>/*` pattern covers the
 * directory and everything beneath it.
 */
export function buildAddDirRules(
  paths: readonly string[],
): Array<{ permission: "external_directory"; pattern: string; action: "allow" }> {
  return paths.map((dir) => ({
    permission: "external_directory" as const,
    pattern: dir.replaceAll("\\", "/").replace(/\/+$/, "") + "/*",
    action: "allow" as const,
  }))
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

/**
 * The server-captured structured result (`info.structured`) of the final
 * assistant message. A run with `format: json_schema` steers the model
 * through a `StructuredOutput` tool and stores the captured object here; the
 * assistant usually produces no text part at all, so this — serialized — is
 * the run's final text. Undefined when the server stored none (an older
 * server, or the model failed the requirement and the message carries a
 * `StructuredOutputError`).
 */
export function extractRunStructuredOutput(
  messages: readonly RunOutputMessageRecord[] | undefined,
  assistantMessageID: string | undefined,
): unknown {
  if (!assistantMessageID) return undefined
  const message = messages?.find((item) => item.info?.role === "assistant" && item.info.id === assistantMessageID)
  return message?.info?.structured
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
