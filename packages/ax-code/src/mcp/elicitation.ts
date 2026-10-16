import type { Client, ClientCapabilities } from "@modelcontextprotocol/client"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { Instance } from "../project/instance"
import { Question } from "../question"
import { ScopedFlag } from "@/flag/scoped"
import { isRecord } from "@/util/record"
import { MessageID, SessionID } from "@/session/schema"

/**
 * Form-mode MCP elicitation.
 *
 * Servers may ask the user for structured input mid-call through
 * `elicitation/create`. Every client built by the MCP implementation
 * advertises form-mode elicitation only (never URL mode) and registers the
 * handler here. The requested flat form schema is mapped onto the session
 * Question prompt of the tool call that is currently in flight on that
 * client; with no in-flight session call the request is declined instead of
 * blocking forever, and autonomous sessions always decline.
 *
 * The server-supplied message, titles, enum labels and descriptions are
 * untrusted text: they are sanitized and length-capped before display, and
 * field values (which may be secrets) are never logged.
 */
export namespace McpElicitation {
  const log = Log.create({ service: "mcp.elicitation" })

  /** A form with more fields than this is declined rather than rendered. */
  export const MAX_FIELDS = 8
  /** An enum (or oneOf) field with more choices than this is declined. */
  export const MAX_ENUM_OPTIONS = 12
  const MAX_MESSAGE_CHARS = 500
  const MAX_TITLE_CHARS = 80
  // Question.Info.header is documented as "max 30 chars".
  const MAX_HEADER_CHARS = 30

  const BOOLEAN_OPTIONS = [
    { label: "Yes", value: "true" },
    { label: "No", value: "false" },
  ] as const

  // ---------------------------------------------------------------------
  // Pure schema -> question mapping
  // ---------------------------------------------------------------------

  export type FieldType = "string" | "enum" | "boolean" | "number"

  /** Display label to raw enum value, for coercing a selected answer back. */
  export type EnumOption = { label: string; value: string }

  export type FieldPlan = {
    name: string
    type: FieldType
    required: boolean
    question: Question.Info
    /** Present for enum fields, ordered like the rendered options. */
    options?: EnumOption[]
    /** Present for number fields. */
    integer?: boolean
    minimum?: number
    maximum?: number
  }

  export type FormPlan = { ok: true; message: string; fields: FieldPlan[] } | { ok: false; reason: string }

  /**
   * Collapse whitespace and strip control characters. Server text is
   * untrusted: newlines and control bytes must not reach the terminal UI,
   * and the length is capped so a hostile message cannot flood the prompt.
   */
  function sanitizeText(value: unknown, maxChars: number): string | undefined {
    if (typeof value !== "string") return undefined
    const normalized = value
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
    if (!normalized) return undefined
    const chars = [...normalized]
    if (chars.length <= maxChars) return chars.join("")
    return `${chars.slice(0, maxChars).join("")}...`
  }

  function capHeader(title: string): string {
    const chars = [...title]
    return chars.length <= MAX_HEADER_CHARS ? chars.join("") : `${chars.slice(0, MAX_HEADER_CHARS).join("")}...`
  }

  function numberConstraint(field: Record<string, unknown>, key: "minimum" | "maximum"): number | undefined {
    const value = field[key]
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }

  function enumOptionList(field: Record<string, unknown>): EnumOption[] | undefined {
    const values: string[] = []
    const labels: (string | undefined)[] = []
    if (Array.isArray(field.enum)) {
      for (const entry of field.enum) {
        if (typeof entry !== "string") return undefined
        values.push(entry)
        labels.push(undefined)
      }
      const names = field.enumNames
      if (Array.isArray(names)) {
        if (names.length !== values.length) return undefined
        for (const [index, name] of names.entries()) {
          if (typeof name !== "string") return undefined
          labels[index] = name
        }
      }
    } else if (Array.isArray(field.oneOf)) {
      for (const entry of field.oneOf) {
        if (!isRecord(entry) || typeof entry.const !== "string") return undefined
        values.push(entry.const)
        labels.push(typeof entry.title === "string" ? entry.title : undefined)
      }
    } else {
      return undefined
    }
    if (values.length === 0 || values.length > MAX_ENUM_OPTIONS) return undefined
    const options: EnumOption[] = []
    for (const [index, value] of values.entries()) {
      const label = sanitizeText(labels[index], MAX_TITLE_CHARS) ?? value
      options.push({ label, value })
    }
    return options
  }

  /**
   * Map a form-mode `elicitation/create` payload onto Question prompts.
   * Unsupported shapes (nested objects, arrays, unknown types, too many
   * fields or choices) reject the whole form: rendering a partial form would
   * collect answers the schema never asked for.
   */
  export function planForm(params: unknown): FormPlan {
    if (!isRecord(params) || !isRecord(params.requestedSchema)) {
      return { ok: false, reason: "params.requestedSchema is missing or malformed" }
    }
    const schema = params.requestedSchema
    if (!isRecord(schema.properties)) return { ok: false, reason: "requestedSchema.properties is missing or malformed" }
    const names = Object.keys(schema.properties)
    if (names.length === 0) return { ok: false, reason: "form has no fields" }
    if (names.length > MAX_FIELDS) return { ok: false, reason: `form has more than ${MAX_FIELDS} fields` }
    const required = new Set(
      Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : [],
    )
    const message = sanitizeText(params.message, MAX_MESSAGE_CHARS) ?? ""
    const fields: FieldPlan[] = []
    for (const name of names) {
      const field = schema.properties[name]
      if (!isRecord(field) || typeof field.type !== "string") {
        return { ok: false, reason: `field "${name}" is malformed or has no type` }
      }
      const title =
        sanitizeText(field.title, MAX_TITLE_CHARS) ?? sanitizeText(field.description, MAX_TITLE_CHARS) ?? name
      const isRequired = required.has(name)
      let type: FieldType
      let options: EnumOption[] | undefined
      let hint = ""
      let integer: boolean | undefined
      const questionOptions: Question.Info["options"] = []
      let custom: boolean | undefined
      switch (field.type) {
        case "string": {
          if (field.enum !== undefined || field.oneOf !== undefined) {
            // Present-but-invalid enums (non-string entries, mismatched
            // enumNames, no choices, too many choices) decline the form
            // rather than degrading to a free-text answer the schema cannot
            // accept.
            const enumOptions = enumOptionList(field)
            if (!enumOptions) {
              return { ok: false, reason: `field "${name}" has a malformed or oversized enum` }
            }
            type = "enum"
            options = enumOptions
            // Fixed choices only: a custom typed answer could never be
            // coerced back to a schema value.
            custom = false
            for (const option of enumOptions) questionOptions.push({ label: option.label, description: option.value })
          } else {
            type = "string"
            if (
              field.format === "uri" ||
              field.format === "email" ||
              field.format === "date" ||
              field.format === "date-time"
            ) {
              hint = ` (${field.format})`
            }
          }
          break
        }
        case "boolean": {
          type = "boolean"
          custom = false
          options = [...BOOLEAN_OPTIONS]
          for (const option of BOOLEAN_OPTIONS) {
            questionOptions.push({ label: option.label, description: option.value })
          }
          break
        }
        case "number":
        case "integer": {
          type = "number"
          integer = field.type === "integer"
          hint = field.type === "integer" ? " (integer)" : " (number)"
          break
        }
        default:
          return { ok: false, reason: `field "${name}" has an unsupported type: ${field.type}` }
      }
      fields.push({
        name,
        type,
        required: isRequired,
        options,
        integer,
        minimum: type === "number" ? numberConstraint(field, "minimum") : undefined,
        maximum: type === "number" ? numberConstraint(field, "maximum") : undefined,
        question: {
          // The message prefixes every field prompt: the question dialog
          // shows one question at a time, so context must not live on the
          // first tab only.
          question: `${message ? `${message} ` : ""}${title}${hint}${isRequired ? " (required)" : ""}`,
          header: capHeader(title),
          options: questionOptions,
          ...(custom === false ? { custom: false } : {}),
        },
      })
    }
    return { ok: true, message, fields }
  }

  // ---------------------------------------------------------------------
  // Pure answer coercion
  // ---------------------------------------------------------------------

  export type CoercionResult =
    | { ok: true; content: Record<string, string | number | boolean> }
    | { ok: false; reason: string }

  /**
   * Coerce Question answers (per-question arrays of selected labels or typed
   * text) back to the schema types. An optional field left empty is omitted
   * from the content; an unusable answer for any field declines the whole
   * response rather than submitting data that misrepresents the user.
   */
  export function coerceAnswers(fields: FieldPlan[], answers: Question.Answer[]): CoercionResult {
    const content: Record<string, string | number | boolean> = {}
    for (const [index, field] of fields.entries()) {
      const entry = answers[index]
      const value = (Array.isArray(entry) && typeof entry[0] === "string" ? entry[0] : "").trim()
      if (!value) {
        if (field.required) return { ok: false, reason: `required field "${field.name}" was left empty` }
        continue
      }
      switch (field.type) {
        case "string":
          content[field.name] = value
          break
        case "boolean": {
          const normalized = value.toLowerCase()
          if (normalized === "yes" || normalized === "true") content[field.name] = true
          else if (normalized === "no" || normalized === "false") content[field.name] = false
          else return { ok: false, reason: `field "${field.name}" was not answered with yes/no` }
          break
        }
        case "enum": {
          const options = field.options ?? []
          const match =
            options.find((option) => option.label === value) ?? options.find((option) => option.value === value)
          if (!match) return { ok: false, reason: `field "${field.name}" selected an unknown choice` }
          content[field.name] = match.value
          break
        }
        case "number": {
          const parsed = Number(value)
          if (!Number.isFinite(parsed))
            return { ok: false, reason: `field "${field.name}" was not answered with a number` }
          if (field.integer && !Number.isInteger(parsed)) {
            return { ok: false, reason: `field "${field.name}" expects an integer` }
          }
          if (field.minimum !== undefined && parsed < field.minimum) {
            return { ok: false, reason: `field "${field.name}" is below its minimum` }
          }
          if (field.maximum !== undefined && parsed > field.maximum) {
            return { ok: false, reason: `field "${field.name}" is above its maximum` }
          }
          content[field.name] = parsed
          break
        }
      }
    }
    return { ok: true, content }
  }

  // ---------------------------------------------------------------------
  // In-flight tool call tracking
  // ---------------------------------------------------------------------

  /**
   * Session identity of the MCP tool call currently in flight on a client.
   * `sessionID` is where the elicitation prompt surfaces, `signal` aborts it
   * with the tool call, and `tool` links the question back to the call part.
   */
  export type CallContext = {
    sessionID: SessionID
    signal?: AbortSignal
    tool?: { messageID: MessageID; callID: string }
  }

  // The AI SDK options object is unique per tool invocation and its identity
  // already flows from the session-layer MCP wrapper into the converted
  // tool's execute (the browserCalls WeakMap relies on the same property),
  // so it is a safe bridge for the session context that the wrapper knows
  // but the conversion layer does not.
  const contextByOptions = new WeakMap<object, CallContext>()
  const activeByClient = new WeakMap<Client, CallContext[]>()

  /** Record the session context of the call that owns `options`. */
  export function bindCallContext(options: object, context: CallContext): void {
    contextByOptions.set(options, context)
  }

  /**
   * Run `fn` with the call context bound to `options` active on `client`, so
   * an `elicitation/create` arriving during the request resolves the session
   * it belongs to. Without a bound context this is a no-op and elicitation
   * is declined by the handler.
   */
  export async function withActiveCall<T>(client: Client, options: object, fn: () => Promise<T>): Promise<T> {
    const context = contextByOptions.get(options)
    if (!context) return fn()
    let active = activeByClient.get(client)
    if (!active) {
      active = []
      activeByClient.set(client, active)
    }
    active.push(context)
    try {
      return await fn()
    } finally {
      const index = active.indexOf(context)
      if (index >= 0) active.splice(index, 1)
    }
  }

  /**
   * The most recent non-aborted call context active on `client`. Concurrent
   * calls on one server are inherently uncorrelated by the protocol, so the
   * latest is the best available attribution.
   */
  export function currentCall(client: Client): CallContext | undefined {
    const active = activeByClient.get(client)
    if (!active || active.length === 0) return undefined
    for (let index = active.length - 1; index >= 0; index--) {
      const context = active[index]
      if (context && !context.signal?.aborted) return context
    }
    return undefined
  }

  // ---------------------------------------------------------------------
  // Decision and client wiring
  // ---------------------------------------------------------------------

  export type Decision = {
    action: "accept" | "decline" | "cancel"
    content?: Record<string, string | number | boolean>
    /** Diagnostic only; never part of the wire response. */
    reason?: string
  }

  export type AskFn = (questions: Question.Info[], call: CallContext) => Promise<Question.Answer[]>

  /**
   * Resolve one `elicitation/create` request to a protocol action. Every
   * non-accept path declines (or cancels on abort) instead of throwing, so a
   * hostile or unsatisfiable form degrades the tool call rather than
   * wedging it.
   */
  export async function decide(input: {
    params: unknown
    call: CallContext | undefined
    autonomous: boolean
    ask: AskFn
  }): Promise<Decision> {
    if (input.autonomous) return { action: "decline", reason: "autonomous mode never blocks on user input" }
    if (!isRecord(input.params) || input.params.mode === "url") {
      return { action: "decline", reason: "only form-mode elicitation is supported" }
    }
    if (!input.call) {
      return { action: "decline", reason: "no in-flight session call is available to surface the prompt in" }
    }
    const plan = planForm(input.params)
    if (!plan.ok) return { action: "decline", reason: plan.reason }
    let answers: Question.Answer[]
    try {
      answers = await input.ask(
        plan.fields.map((field) => field.question),
        input.call,
      )
    } catch (error) {
      if (error instanceof Question.RejectedError) {
        return input.call.signal?.aborted
          ? { action: "cancel", reason: "the tool call was aborted while the prompt was open" }
          : { action: "decline", reason: "the user dismissed the prompt" }
      }
      return { action: "decline", reason: `asking failed: ${toErrorMessage(error)}` }
    }
    const coerced = coerceAnswers(plan.fields, answers)
    if (!coerced.ok) return { action: "decline", reason: coerced.reason }
    return { action: "accept", content: coerced.content }
  }

  /** The client capability advertised on every MCP client: form mode only. */
  export function clientCapabilities(): Pick<ClientCapabilities, "elicitation"> {
    return { elicitation: { form: {} } }
  }

  /**
   * Register the `elicitation/create` handler on a client. Bound to the
   * instance context that created the client so the question state, the
   * session prompt and the autonomous flag resolve against the same project
   * directory for the client's whole lifetime.
   */
  export function registerHandler(client: Client, serverName: string): void {
    client.setRequestHandler(
      "elicitation/create",
      Instance.bind(
        async (request: {
          params: unknown
        }): Promise<{
          action: "accept" | "decline" | "cancel"
          content?: Record<string, string | number | boolean>
        }> => {
          const decision = await decide({
            params: request.params,
            call: currentCall(client),
            autonomous: ScopedFlag.autonomous(),
            ask: (questions, call) =>
              Question.ask({
                sessionID: call.sessionID,
                questions,
                tool: call.tool,
                signal: call.signal,
              }),
          })
          const { reason, ...result } = decision
          // Reasons are diagnostic strings built here (field names, counts);
          // field values never reach the log.
          log.info("mcp elicitation resolved", { server: serverName, action: result.action, reason })
          return result
        },
      ),
    )
  }
}
