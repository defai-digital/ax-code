import { defer } from "@/util/defer"
import type { Argv } from "yargs"
import { AsyncLocalStorage } from "node:async_hooks"
import { readFile, realpath } from "fs/promises"
import path from "path"
import { pathToFileURL } from "url"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { confirmDirectoryScope } from "../directory-scope-prompt"
import { buildAttachAuthHeaders, buildAttachHeaders } from "../attach-auth"
import { EOL } from "os"
import { Filesystem } from "../../util/filesystem"
import { createAxCodeClient, type AxCodeClient, type ToolPart, type Event } from "@ax-code/sdk/v2"
import type { Permission } from "../../permission"
import { Log } from "../../util/log"
import { toErrorMessage } from "../../util/error-message"
import { DEFAULT_SERVER_PORT } from "@/server/constants"
import type { Tool } from "../../tool/tool"
import type { GlobTool } from "../../tool/glob"
import type { GrepTool } from "../../tool/grep"
import type { ListTool } from "../../tool/ls"
import type { ReadTool } from "../../tool/read"
import type { WebFetchTool } from "../../tool/webfetch"
import type { EditTool } from "../../tool/edit"
import type { WriteTool } from "../../tool/write"
import type { CodeSearchTool } from "../../tool/codesearch"
import type { WebSearchTool } from "../../tool/websearch"
import type { TaskTool } from "../../tool/task"
import type { SkillTool } from "../../tool/skill"
import type { BashTool } from "../../tool/bash"
import type { TodoWriteTool } from "../../tool/todo"
import { Todo } from "../../session/todo"
import { Locale } from "../../util/locale"
import { internalBaseUrl, isInternalHostname } from "../../util/internal-url"
import { isNonEmptyRecord } from "../../util/record"
import {
  accountToolCompletion,
  buildAddDirRules,
  buildRunEarlyErrorEvent,
  buildRunResultEvent,
  classifyRunFailure,
  createRunToolAccounting,
  extractRunFinalAssistantText,
  extractRunStructuredOutput,
  extractRunUsageTotals,
  handleRunStructuredOutput,
  isBlockedRun,
  isRunAuthFailure,
  isRunSelfAbortError,
  parseDisallowedTools,
  preflightRunOutputSchema,
  redactRunUrlCredentials,
  resolveRunResultStatus,
  runFileMime,
  RUN_BUILTIN_TOOL_IDS,
  type RunEarlyErrorCode,
  type RunUsageTotals,
} from "./run-output"
import { createRunLifecycle, RUN_SERVER_ABORT_BOUND_MS } from "./run-lifecycle"
import { printPendingScheduledTaskNotice } from "./run-schedule-notice"
import { assertLoopbackHttpUrl } from "../../runtime/listen-security"
import { sameSkuOnConnectedProvider } from "../../provider/model-selectability"
import { DEFAULT_STDIN_PIPE_QUIET_WINDOW_MS, readNonTtyStdin } from "../stdin"
import { CLI_CONCISE_MAX_LINES, diffSummary, formatDiffSummary, tailLines } from "../../util/tool-output"

type ToolProps<T extends Tool.Info> = {
  input: Tool.InferParameters<T>
  metadata: Tool.InferMetadata<T>
  part: ToolPart
}

function props<T extends Tool.Info>(part: ToolPart): ToolProps<T> {
  const state = part.state
  return {
    input: state.input as Tool.InferParameters<T>,
    metadata: ("metadata" in state ? state.metadata : {}) as Tool.InferMetadata<T>,
    part,
  }
}

type Inline = {
  icon: string
  title: string
  description?: string
}

const pathDisplayRootContext = new AsyncLocalStorage<string>()

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function warnPrefix(message: string) {
  UI.println(UI.Style.TEXT_WARNING_BOLD + "!", UI.Style.TEXT_NORMAL, message)
}

function toolStateOutput(part: ToolPart): string | undefined {
  if ("output" in part.state) return part.state.output
  return undefined
}

function describeFilesystemSearchTool(input: { label: string; pattern: string; rootPath?: string; matches?: number }) {
  const suffix = input.rootPath ? `in ${normalizePath(input.rootPath)}` : ""
  const description =
    input.matches === undefined
      ? suffix
      : `${suffix}${suffix ? " · " : ""}${input.matches} ${input.matches === 1 ? "match" : "matches"}`
  inline({
    icon: "✱",
    title: `${input.label} "${input.pattern}"`,
    ...(description && { description }),
  })
}

function omittedHint(capped: { total: number; truncated: boolean }) {
  if (!capped.truncated) return
  UI.println(
    UI.Style.TEXT_DIM +
      `… ${capped.total - CLI_CONCISE_MAX_LINES} more lines omitted (${capped.total} total); pass --full to show all` +
      UI.Style.TEXT_NORMAL,
  )
}

// Renders a completed tool block. Concise by default: long output is reduced
// to its tail (failures cluster at the end) with an omission hint; --full
// restores the previous full-output behavior for auditing.
function block(info: Inline, output: string | undefined, full: boolean) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  if (full) {
    UI.println(output)
    UI.empty()
    return
  }
  const capped = tailLines(output)
  UI.println(capped.text)
  omittedHint(capped)
  UI.empty()
}

// `--format json` is a newline-delimited JSON (NDJSON) event stream — one
// JSON object per line, not a single JSON document — kept as-is for backward
// compatibility. `jsonl` and `ndjson` are explicit aliases for the same
// stream (#419).
export function isRunEventStreamFormat(format: string | undefined): boolean {
  return format === "json" || format === "jsonl" || format === "ndjson"
}

export function joinRunMessageArguments(args: readonly string[]): string {
  // Yargs has already removed shell quoting and preserved each argument's
  // contents. Re-adding quotes around an argument containing spaces changes
  // the user's prompt and can defeat prompt classification downstream.
  return args.join(" ")
}

export function composeRunMessage(input: {
  message?: readonly string[]
  rest?: readonly string[]
  prompt?: string
  promptFileText?: string
}): string {
  const parts: string[] = []
  if (input.promptFileText) {
    const fileText = input.promptFileText.replace(/\n+$/, "")
    if (fileText.length > 0) parts.push(fileText)
  }
  if (input.prompt) parts.push(input.prompt)
  const positional = joinRunMessageArguments([...(input.message ?? []), ...(input.rest ?? [])])
  if (positional.length > 0) parts.push(positional)
  return parts.join("\n")
}

export function missingRunPromptMessage(): string {
  const lines = [
    "You must provide a message or a command.",
    "Pass the prompt after --, or use --prompt / --prompt-file.",
    'Example: ax-code run --model qwen -- "Review this change"',
    "--file attaches files; it is not a prompt file.",
  ]
  return lines.join("\n")
}

export function formatRunToolFallbackInput(input: unknown): string {
  if (!isNonEmptyRecord(input)) return "Unknown"
  const seen = new WeakSet<object>()
  try {
    return (
      JSON.stringify(input, (_key, value) => {
        if (typeof value === "bigint") return value.toString()
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[Circular]"
          seen.add(value)
        }
        return value
      }) ?? "Unknown"
    )
  } catch {
    return "Unknown"
  }
}

/** Extract `.name` from an unknown error (a rejected HTTP body or a thrown error). */
function errorNameOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined
  const name = (error as { name?: unknown }).name
  return typeof name === "string" ? name : undefined
}

type RunProviderList = Parameters<typeof sameSkuOnConnectedProvider>[0]

export function findRunModelError(input: {
  providers: RunProviderList
  providerID: string
  modelID: string
}): string | undefined {
  const provider = input.providers.find((item) => item.id === input.providerID)
  if (!provider) {
    return (
      `Unknown provider "${input.providerID}" for model "${input.providerID}/${input.modelID}". ` +
      "Run `ax-code models` for usable IDs."
    )
  }
  if (!provider.models[input.modelID]) {
    return (
      `Model "${input.modelID}" not found for provider "${input.providerID}". ` + "Run `ax-code models` for usable IDs."
    )
  }
  return undefined
}

/**
 * The structured early-error code matching a `findRunModelError` message:
 * unknown provider vs unknown model on a known provider. Call only when
 * `findRunModelError` already returned a message.
 */
export function findRunModelErrorCode(input: {
  providers: RunProviderList
  providerID: string
  modelID: string
}): RunEarlyErrorCode {
  const provider = input.providers.find((item) => item.id === input.providerID)
  return provider ? "model" : "provider"
}

/** Yargs usage-failure message prefixes the shared CLI failure handler recognizes. */
const CLI_USAGE_FAILURE_PREFIXES: readonly string[] = [
  "Unknown argument",
  "Not enough non-option arguments",
  "Invalid values:",
  "Missing required argument",
]

export function isCliUsageFailureMessage(message: string | undefined): boolean {
  return message !== undefined && CLI_USAGE_FAILURE_PREFIXES.some((prefix) => message.startsWith(prefix))
}

/** The offending token in a yargs "Unknown argument: x" message, when present. */
function unknownArgumentToken(message: string): string | undefined {
  if (!message.startsWith("Unknown argument")) return undefined
  const token = message
    .slice("Unknown argument".length)
    .replace(/^[:\s]+/, "")
    .trim()
  return token.length > 0 ? token : undefined
}

/**
 * Hint appended to a yargs usage failure ("Unknown argument",
 * "Invalid values", "Missing required argument", "Not enough non-option
 * arguments") when the failing command is `run`, so headless callers get a
 * one-line pointer instead of a full help dump. A bare `json` argument is
 * almost always a mistyped `--format json`, so it gets the NDJSON-specific
 * hint.
 */
export function runUsageFailureHint(message: string | undefined, command: string | undefined): string | undefined {
  if (command !== "run") return undefined
  if (!isCliUsageFailureMessage(message)) return undefined
  if (unknownArgumentToken(message ?? "") === "json") {
    return "Use --format json for the NDJSON event stream (run --help lists the accepted flags)."
  }
  return "Run `ax-code run --help` to see the accepted flags."
}

/**
 * Whether the shared CLI failure handler prints the full help for this usage
 * failure: the `run` command prints only the one-line error plus the hint
 * above (scripted callers must be able to read stderr), every other command
 * keeps the full help dump.
 */
export function cliFailureShowsFullHelp(message: string | undefined, command: string | undefined): boolean {
  return isCliUsageFailureMessage(message) && command !== "run"
}

/**
 * The command yargs is parsing, derived from the raw CLI arguments: the
 * first non-flag token after the entry. Global value-taking flags
 * (--log-level, --sandbox, --debug-dir) skip their value so a flag value is
 * never mistaken for the command, and nothing after `--` counts. Used by the
 * shared CLI failure handler to attribute an "Unknown argument" error to its
 * command without depending on yargs internals, which do not expose the
 * command chain reliably at strict-fail time.
 */
export function commandTokenFromArgv(argv: readonly string[]): string | undefined {
  const valueFlags = new Set(["--log-level", "--sandbox", "--debug-dir"])
  let skipValue = false
  for (const token of argv) {
    if (skipValue) {
      skipValue = false
      continue
    }
    if (token === "--") return undefined
    if (token.startsWith("-")) {
      if (!token.includes("=") && valueFlags.has(token)) skipValue = true
      continue
    }
    return token
  }
  return undefined
}

/**
 * Whether the raw CLI argv selects the `run` command with one of the NDJSON
 * event-stream `--format` values (spaced or `=` spelling). Used by the shared
 * CLI failure handler so a yargs-level usage failure (e.g. a mistyped flag)
 * still writes one structured `{"type":"error",...}` stdout line for stream
 * consumers before the human-readable stderr prose — without it they get
 * nothing on stdout at all.
 */
export function runArgvUsesEventStream(argv: readonly string[]): boolean {
  if (commandTokenFromArgv(argv) !== "run") return false
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    // Prompt text after `--` must never match, even when it spells a flag.
    if (token === "--") return false
    if (token === "--format") {
      const value = argv[i + 1]
      if (value !== undefined && isRunEventStreamFormat(value)) return true
      continue
    }
    if (token.startsWith("--format=") && isRunEventStreamFormat(token.slice("--format=".length))) return true
  }
  return false
}

/**
 * The requested model when its provider lists it and is connected, else the
 * same model ID on a connected provider: config and docs keep naming a SKU by its native
 * provider (`deepseek/deepseek-v4-pro`) after that provider was disabled and
 * a custom gateway took over serving it. `connected` narrows the fallback to
 * providers that can actually serve a turn — the full list also carries
 * catalog-only providers. Undefined when neither exists.
 */
export function resolveRunModel(input: {
  providers: RunProviderList
  connected?: readonly string[]
  providerID: string
  modelID: string
}): { providerID: string; modelID: string } | undefined {
  const exactIsConnected = !input.connected || input.connected.includes(input.providerID)
  if (!findRunModelError(input) && exactIsConnected) {
    return { providerID: input.providerID, modelID: input.modelID }
  }
  const connected = input.connected
  const candidates = connected ? input.providers.filter((provider) => connected.includes(provider.id)) : input.providers
  return sameSkuOnConnectedProvider(candidates, input)
}

export async function refreshRunProvidersOnModelMiss(input: {
  providers: RunProviderList
  connected?: readonly string[]
  providerID: string
  modelID: string
  refresh: () => Promise<RunProviderList | undefined>
}) {
  if (resolveRunModel(input)) return input.providers
  return input.refresh()
}

export async function resolveRunAgentDisplayName(input: {
  agentName: string
  attached: boolean
  listLocalAgents: () => Promise<Array<{ name: string; displayName?: string }>>
  listAttachedAgents: () => Promise<Array<{ name: string; displayName?: string }>>
}) {
  const agents = await (input.attached ? input.listAttachedAgents() : input.listLocalAgents())
  const entry = agents.find((agent) => agent.name === input.agentName)
  return entry?.displayName ?? input.agentName
}

function fallback(part: ToolPart) {
  const state = part.state
  const input = "input" in state ? state.input : undefined
  const title = ("title" in state && state.title ? state.title : undefined) || formatRunToolFallbackInput(input)
  inline({
    icon: "⚙",
    title: `${part.tool} ${title}`,
  })
}

function completedOutput(status: string, output?: string, trim?: boolean) {
  if (status !== "completed") return undefined
  if (!trim) return output
  return output?.trim()
}

function glob(info: ToolProps<typeof GlobTool>) {
  describeFilesystemSearchTool({
    label: "Glob",
    pattern: info.input.pattern,
    rootPath: info.input.path,
    matches: info.metadata.count,
  })
}

function grep(info: ToolProps<typeof GrepTool>) {
  describeFilesystemSearchTool({
    label: "Grep",
    pattern: info.input.pattern,
    rootPath: info.input.path,
    matches: info.metadata.matches,
  })
}

function list(info: ToolProps<typeof ListTool>) {
  const dir = info.input.path ? normalizePath(info.input.path) : ""
  inline({
    icon: "→",
    title: dir ? `List ${dir}` : "List",
  })
}

function read(info: ToolProps<typeof ReadTool>) {
  const file = normalizePath(info.input.filePath)
  const pairs = Object.entries(info.input).filter(([key, value]) => {
    if (key === "filePath") return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  const description = pairs.length ? `[${pairs.map(([key, value]) => `${key}=${value}`).join(", ")}]` : undefined
  inline({
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  })
}

function write(info: ToolProps<typeof WriteTool>, full: boolean) {
  block(
    {
      icon: "←",
      title: `Write ${normalizePath(info.input.filePath)}`,
    },
    completedOutput(info.part.state.status, toolStateOutput(info.part)),
    full,
  )
}

function webfetch(info: ToolProps<typeof WebFetchTool>) {
  inline({
    icon: "%",
    title: `WebFetch ${info.input.url}`,
  })
}

function edit(info: ToolProps<typeof EditTool>, full: boolean) {
  const title = normalizePath(info.input.filePath)
  if (full) {
    block(
      {
        icon: "←",
        title: `Edit ${title}`,
      },
      info.metadata.diff,
      true,
    )
    return
  }
  UI.empty()
  inline({
    icon: "←",
    title: `Edit ${title}`,
  })
  const summary = diffSummary(info.metadata.diff)
  if (summary) {
    UI.println(UI.Style.TEXT_DIM + `${formatDiffSummary(summary)}; pass --full to show the diff` + UI.Style.TEXT_NORMAL)
  }
  UI.empty()
}

function codesearch(info: ToolProps<typeof CodeSearchTool>) {
  inline({
    icon: "◇",
    title: `Exa Code Search "${info.input.query}"`,
  })
}

function websearch(info: ToolProps<typeof WebSearchTool>) {
  inline({
    icon: "◈",
    title: `Exa Web Search "${info.input.query}"`,
  })
}

function task(info: ToolProps<typeof TaskTool>) {
  const input = info.part.state.input
  const status = info.part.state.status
  const subagent =
    typeof input.subagent_type === "string" && input.subagent_type.trim().length > 0 ? input.subagent_type : "unknown"
  const agent = Locale.titlecase(subagent)
  const desc =
    typeof input.description === "string" && input.description.trim().length > 0 ? input.description : undefined
  const icon = status === "error" ? "✗" : status === "running" ? "•" : "✓"
  const name = desc ?? `${agent} Task`
  inline({
    icon,
    title: name,
    description: desc ? `${agent} Agent` : undefined,
  })
}

function skill(info: ToolProps<typeof SkillTool>) {
  inline({
    icon: "→",
    title: info.input.query !== undefined ? `Skill search "${info.input.query}"` : `Skill "${info.input.name}"`,
  })
}

function bash(info: ToolProps<typeof BashTool>, full: boolean) {
  const output = completedOutput(info.part.state.status, toolStateOutput(info.part), true)
  block(
    {
      icon: "$",
      title: `${info.input.command}`,
    },
    output,
    full,
  )
}

function todo(info: ToolProps<typeof TodoWriteTool>, full: boolean) {
  if (full) {
    block(
      {
        icon: "#",
        title: "Todos",
      },
      Todo.formatCheckboxLines(info.input.todos).join("\n"),
      true,
    )
    return
  }
  UI.empty()
  inline({
    icon: "#",
    title: "Todos",
  })
  const todos = info.input.todos
  const done = todos.filter((item) => item.status === "completed").length
  UI.println(
    UI.Style.TEXT_DIM +
      `${Todo.countActive(todos)} active · ${done} done · ${todos.length} total; pass --full to show the list` +
      UI.Style.TEXT_NORMAL,
  )
  UI.empty()
}

function normalizePath(input?: string) {
  if (!input) return ""
  const displayRoot = pathDisplayRootContext.getStore() ?? process.cwd()
  if (path.isAbsolute(input)) return path.relative(displayRoot, input) || "."
  return input
}

/**
 * Shared mutable state between the handler body and the pre-session-timeout
 * bail inside `executeRun`.
 */
type RunAbortState = {
  /**
   * True once a pre-session `--timeout` fired and emitted the terminal
   * timeout result itself. The submission must not start afterwards, and the
   * SDK calls it aborts are expected fallout — see `convertRunRejection`.
   */
  earlyTimeoutEmitted: boolean
}

/**
 * Whether the error is (or wraps) an AbortError from an aborted fetch, e.g.
 * the SDK calls cut by the pre-session `--timeout`. Wrapping is walked on
 * both the `cause` chain and an `AggregateError`'s `errors` array — Promise
 * combinators aggregate their failures there, not in `cause`.
 */
export function isAbortError(error: unknown, seen: Set<object> = new Set()): boolean {
  if (typeof error !== "object" || error === null || seen.has(error)) return false
  seen.add(error)
  if (errorNameOf(error) === "AbortError") return true
  if (isAbortError((error as { cause?: unknown }).cause, seen)) return true
  const aggregated = (error as { errors?: unknown }).errors
  if (Array.isArray(aggregated)) {
    for (const inner of aggregated) {
      if (isAbortError(inner, seen)) return true
    }
  }
  return false
}

/**
 * A5: no rejection may leave the `run` handler unstructured. Every early
 * exit already throws `UI.CancelledError` via `exitEarly` (pass through
 * unchanged); any other rejection — a deserialized HTTP error body, a socket
 * failure, an unexpected bug — is converted here into the structured
 * early-error contract: stream formats get one terminal
 * `{"type":"error","error":{"code","message"}}` stdout line (code "session"
 * for a missing session, "attach" for an unreachable server, "internal"
 * otherwise), text mode gets exactly one `Error:` line, and the rethrown
 * `UI.CancelledError` keeps boot.ts's fatal handler from printing a second
 * "Unexpected error, check log file" block (and its `[object Object]` line
 * for plain rejected bodies). The terminal `result` line is never emitted on
 * this path: these rejections all leave `execute` before its final write.
 *
 * Once the run's terminal outcome is committed — the terminal result or
 * error line was already written (the lifecycle's terminal guard), or the
 * exit code was decided by the `--timeout` timer or a SIGINT/SIGTERM —
 * every later rejection is expected fallout of tearing the run down: a
 * server 5xx racing the abort, an SDK-wrapped error, or an AggregateError
 * whose `errors` array holds the AbortError. Such rejections are logged at
 * debug level and swallowed so no second terminal line is written and the
 * committed exit code (124 / 130 / 1) stands. Attach URLs interpolated into
 * messages carry their userinfo password masked.
 */
async function convertRunRejection(
  args: { format?: string; attach?: string },
  body: () => Promise<void>,
  getAttachUrl: () => string | undefined = () => args.attach,
  isOutcomeCommitted: () => boolean = () => false,
): Promise<void> {
  try {
    await body()
  } catch (error) {
    if (UI.CancelledError.isInstance(error)) throw error
    if (isOutcomeCommitted()) {
      Log.Default.debug("run rejection after committed terminal outcome; swallowed", {
        error: error instanceof Error ? error.message : undefined,
      })
      return
    }
    const classified = classifyRunFailure(error)
    const attachUrl = redactRunUrlCredentials(getAttachUrl() ?? internalBaseUrl())
    const message =
      classified.code === "attach"
        ? isRunAuthFailure(error)
          ? `${classified.message} at ${attachUrl}. Use --runtime or set AX_CODE_RUNTIME_TOKEN (or pass --password for basic auth).`
          : `Cannot reach ax-code server at ${attachUrl}: ${classified.message}`
        : classified.message
    Log.Default.error("run command failed", {
      code: classified.code,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    })
    process.exitCode = 1
    if (isRunEventStreamFormat(args.format)) {
      process.stdout.write(JSON.stringify(buildRunEarlyErrorEvent(classified.code, message)) + EOL)
    }
    UI.error(message)
    throw new UI.CancelledError()
  }
}

export const RunCommand = cmd({
  command: "run [message..]",
  describe: "run a one-shot headless task and print the assistant reply",
  builder: (yargs: Argv) => {
    return yargs
      .wrap(null)
      .positional("message", {
        describe: "prompt text (put it after -- so flags such as --file do not consume it)",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe:
          "model to use: provider/model from `ax-code models`, or family name deepseek, glm, qwen (Flash defaults)",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json", "jsonl", "ndjson"],
        default: "default",
        describe:
          "output format: default (final assistant text) or json/jsonl/ndjson " +
          "(newline-delimited JSON event stream — one JSON object per line, not a single JSON document; " +
          "emits error and permission_denied events and ends with a terminal result line)",
      })
      .option("output-file", {
        alias: ["o"],
        type: "string",
        describe: "write the final assistant message to a file",
      })
      .option("output-schema", {
        type: "string",
        describe:
          "validate the final assistant message as JSON against a JSON Schema file " +
          "(also sent to the model so the server steers and retries toward it)",
      })
      .option("append-system-prompt", {
        type: "string",
        describe:
          "append this text to the system prompt after the agent and environment prompts; " +
          "it never replaces the built-in system prompt",
      })
      .option("append-system-prompt-file", {
        type: "string",
        describe:
          "append the file's text to the system prompt (never replaces it); " +
          "mutually exclusive with --append-system-prompt",
      })
      .option("disallowed-tools", {
        type: "string",
        array: true,
        nargs: 1,
        describe:
          "disable tools by id for this run (comma-separated, repeatable; MCP tool ids are allowed " +
          "and unknown ids only warn)",
      })
      .option("add-dir", {
        type: "string",
        array: true,
        nargs: 1,
        describe:
          "grants tools access to PATH; does not change --file containment " + "(repeatable; new sessions only)",
      })
      .option("prompt", {
        alias: ["p"],
        type: "string",
        describe: "prompt text (same as the message positional; preferred by other CLIs)",
      })
      .option("prompt-file", {
        type: "string",
        describe: "read prompt text from a file (not an attachment; use --file to attach)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        nargs: 1,
        describe: "attach a file to the message (repeatable; does not replace the prompt)",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: `attach to a running ax-code server (e.g., http://localhost:${DEFAULT_SERVER_PORT})`,
      })
      .option("runtime", {
        type: "boolean",
        describe: "attach to the managed runtime of the project directory (--dir when given, else the caller cwd)",
      })
      .option("password", {
        type: "string",
        describe:
          "basic auth password for --attach (not a prompt; defaults to AX_CODE_SERVER_PASSWORD); " +
          "for a managed runtime use --runtime or AX_CODE_RUNTIME_TOKEN",
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on the attached local server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "include reasoning/thinking in the output (hidden by default)",
        default: false,
      })
      .option("full", {
        type: "boolean",
        describe: "show full tool output (diffs, command output, todo list) instead of concise summaries",
        default: false,
      })
      .option("quiet", {
        type: "boolean",
        describe:
          "suppress the stderr agent/model header, tool-progress blocks, and non-error warnings " +
          "(default format; errors on stderr and stdout content are unchanged)",
        default: false,
      })
      .option("show-history", {
        type: "boolean",
        describe: "print visible session history when resuming a session (requires --session or --continue)",
        default: false,
      })
      .option("history-limit", {
        type: "number",
        describe: "cap history to the newest N messages (requires --show-history)",
      })
      .option("timeout", {
        type: "number",
        describe: 'abort the run after this many seconds and exit 124 (result.status "timeout")',
      })
      .epilog(
        "When no positional message or --prompt/--prompt-file is given, piped stdin is used as the prompt. " +
          `The stdin reader waits for a ${DEFAULT_STDIN_PIPE_QUIET_WINDOW_MS} ms quiet window: write your prompt ` +
          "promptly and close stdin; use --prompt-file for large or slowly produced prompts. " +
          "--prompt-file - reads the prompt from stdin explicitly.",
      )
      .example('ax-code run --model qwen -- "Review this"', "put the prompt after --")
      .example('ax-code run --prompt "Review this" --model qwen', "same prompt via --prompt")
      .example("ax-code run --prompt-file ./prompt.txt --model qwen", "read the prompt from a file")
      .example(
        "ax-code run --file README.md --prompt Summarize --model qwen",
        "attach a file; --file is not the prompt",
      )
      .example('echo "Summarize README.md" | ax-code run --model qwen', "read the prompt from piped stdin")
      .example(
        'ax-code run --append-system-prompt "Answer in English only" --model qwen -- "Review this"',
        "append extra system-prompt text (never replaces the built-in prompt)",
      )
      .example(
        'ax-code run --disallowed-tools bash,write --sandbox read-only --model qwen -- "Audit this module"',
        "disable tools by id and run read-only",
      )
      .example(
        'ax-code run --add-dir ../design-docs --model qwen -- "Summarize ../design-docs/spec.md"',
        "grant tools access to an extra directory (--file attachments must stay inside the project)",
      )
  },
  handler: async (args) => {
    const abortState: RunAbortState = { earlyTimeoutEmitted: false }
    // Resolved by the --runtime branch inside `body`; the failure converter reads
    // it so an auth/connection rejection names the runtime URL instead of args.attach.
    let runtimeAttach: { baseUrl: string; headers: Record<string, string>; directory: string } | undefined
    // Bounded-run state (timer/signal/abort/exit-code precedence) lives in the
    // lifecycle module so the once-only guards and precedence rule are
    // unit-testable without a server. The server-abort helper is assigned a
    // real implementation once `execute` knows the session; until then the
    // callback is a no-op, exactly like the previous inline holder.
    let serverAbort: (reason: "timeout" | "cancelled") => void = () => {}
    const lifecycle = createRunLifecycle({
      timeoutSeconds: args.timeout,
      isStream: isRunEventStreamFormat(args.format),
      onTimeoutNotice: () => UI.error(`run timed out after ${args.timeout} s`),
      onCancelNotice: () => UI.error("run cancelled"),
      onEarlyResult: (status) => {
        if (status === "timeout") abortState.earlyTimeoutEmitted = true
        process.stdout.write(
          JSON.stringify(
            buildRunResultEvent({
              timestamp: Date.now(),
              sessionID: "",
              status,
              text: "",
              permissionDenials: 0,
            }),
          ) + EOL,
        )
      },
      onServerAbort: (reason) => serverAbort(reason),
    })
    const onRunSignal = lifecycle.onSignal
    return convertRunRejection(
      args,
      async () => {
        const { Server } = await import("../../server/server")
        const { Provider } = await import("../../provider/provider")
        const { Agent } = await import("../../agent/agent")
        const { ServerRuntimeAuth } = await import("../../server/runtime-auth")
        const exitEarly = (message: string, code: RunEarlyErrorCode = "usage"): never => {
          // Single-writer rule (the lifecycle's terminal guard): once any
          // terminal line was written, later early exits stay log-only — no
          // second structured stdout line, no exit-code overwrite.
          if (lifecycle.terminal()) {
            Log.Default.debug("run early exit after terminal line", { code, message })
            throw new UI.CancelledError()
          }
          lifecycle.markTerminal()
          // Commit the exit code before any output so every early-exit path
          // carries exit 1 even if a write below throws, and callers that inspect
          // process.exitCode right at the rejection see it without depending on
          // the top-level CLI handler.
          process.exitCode = 1
          // Stream consumers get one structured stdout line before the
          // human-readable stderr prose so an early exit stays diagnosable.
          if (isRunEventStreamFormat(args.format)) {
            process.stdout.write(JSON.stringify(buildRunEarlyErrorEvent(code, message)) + EOL)
          }
          UI.error(message)
          throw new UI.CancelledError()
        }
        const callerCwd = Filesystem.callerCwd()
        const previousCwd = process.cwd()
        // --quiet keeps stderr to errors only: the header, tool-progress blocks,
        // and non-error warnings are dropped; stdout content is untouched.
        const quiet = args.quiet === true
        const warn = (message: string) => {
          if (!quiet) warnPrefix(message)
        }

        // Bounded-run state (timedOut/cancelled flags, the --timeout timer,
        // and the SIGINT/SIGTERM handler) lives in `lifecycle` created at
        // handler scope; `lifecycle.signal` is threaded into every SDK call
        // so a timeout or signal cuts pending requests too, not just the
        // server-side generation. `serverAbort` (handler scope) is assigned
        // the real implementation once `execute` knows the session.

        let promptFileText: string | undefined
        // `--prompt-file -` reads the prompt from stdin explicitly (like other
        // headless CLIs). Yargs cannot carry a lone dash as an option value: the
        // `=` spelling parses to "-", while the spaced spelling parses to an
        // empty string (the dash token is dropped), so both select stdin. The
        // implicit "append piped stdin" step further down must not run a second
        // time, so its consumption is recorded there.
        const promptFileFlag = args["prompt-file"]
        let stdinConsumedByPromptFile = false
        if (promptFileFlag === "-" || promptFileFlag === "") {
          if (process.stdin.isTTY) {
            exitEarly("--prompt-file - requires the prompt on piped stdin, but stdin is a TTY")
          }
          promptFileText = await readNonTtyStdin()
          stdinConsumedByPromptFile = true
        } else if (promptFileFlag) {
          // @scan-suppress security_scan - The caller explicitly selects this local file; CLI filesystem permissions are the authority.
          const resolvedPromptFile = path.resolve(callerCwd, promptFileFlag)
          if (!(await Filesystem.exists(resolvedPromptFile))) {
            exitEarly(`Prompt file not found: ${promptFileFlag}`)
          }
          if (await Filesystem.isDir(resolvedPromptFile)) {
            exitEarly(`Prompt file is a directory: ${promptFileFlag}`)
          }
          promptFileText = await readFile(resolvedPromptFile, "utf8")
        }

        let message = composeRunMessage({
          message: args.message,
          rest: args["--"],
          prompt: args.prompt,
          promptFileText,
        })

        if (args.model) {
          try {
            Provider.parseModel(args.model)
          } catch (error) {
            exitEarly(toErrorMessage(error), "model")
          }
        }

        const directory = (() => {
          if (!args.dir) return undefined
          if (args.attach || args.runtime) return args.dir
          try {
            process.chdir(path.resolve(callerCwd, args.dir))
            return process.cwd()
          } catch {
            exitEarly("Failed to change directory to " + args.dir)
          }
        })()
        const runtimeDirectory = directory || callerCwd
        // @scan-suppress security_scan - This caller-selected CLI directory is used for display paths, not a filesystem access grant.
        const pathDisplayRoot = directory && path.isAbsolute(directory) ? path.resolve(directory) : process.cwd()

        // Skip when attaching: --attach and --runtime connect to an already-running
        // instance rather than scanning `directory` locally, so there's nothing to guard.
        if (!args.attach && !args.runtime) {
          const scopeGate = await confirmDirectoryScope(runtimeDirectory)
          if (!scopeGate.proceed) exitEarly(scopeGate.message ?? "Aborted.")
        }

        // --add-dir: each path must exist and be a directory (resolved against
        // the caller cwd like --file). The resolved paths feed the new-session
        // permission rules only; --file containment below is never widened —
        // the server denies outside-project attachments regardless of
        // permission rules (prompt-file-attachment.ts).
        // The tool side canonicalizes with realpath(parentDir) before asking
        // (tool/external-directory.ts), so a symlinked --add-dir path would
        // produce a resolved-spelled rule that never matches the real-spelled
        // ask. Emit BOTH spellings when realpath differs (realpath falls back
        // to the resolved path when it cannot resolve, e.g. a broken
        // filesystem edge).
        const addDirPaths: string[] = []
        if (args["add-dir"]) {
          const addDirList = Array.isArray(args["add-dir"]) ? args["add-dir"] : [args["add-dir"]]
          const addDirBase = directory ?? callerCwd
          for (const dirPath of addDirList) {
            // @scan-suppress security_scan - The CLI caller explicitly grants these directories; existence and realpath are checked below.
            const resolvedDir = path.resolve(addDirBase, dirPath)
            if (!(await Filesystem.exists(resolvedDir))) {
              exitEarly(`Directory not found: ${dirPath}`)
            }
            if (!(await Filesystem.isDir(resolvedDir))) {
              exitEarly(`Not a directory: ${dirPath}`)
            }
            addDirPaths.push(resolvedDir)
            const realDir = await realpath(resolvedDir).catch(() => resolvedDir)
            if (realDir !== resolvedDir) addDirPaths.push(realDir)
          }
          // The ruleset is applied at session create time; an existing session
          // (--session/--continue) cannot pick it up, so say so and continue.
          if (addDirPaths.length > 0 && (args.session || args.continue)) {
            warn("--add-dir applies only to new sessions")
          }
        }

        const files: { type: "file"; url: string; filename: string; mime: string }[] = []
        if (args.file) {
          const list = Array.isArray(args.file) ? args.file : [args.file]
          const fileBaseDir = directory ?? callerCwd

          for (const filePath of list) {
            // @scan-suppress security_scan - Attachment paths are checked for project containment below and revalidated by the server.
            const resolvedPath = path.resolve(fileBaseDir, filePath)
            if (!(await Filesystem.exists(resolvedPath))) {
              exitEarly(`File not found: ${filePath}`)
            }
            // The server denies any attachment outside the project directory
            // regardless of permission rules (Instance.containsPath in
            // prompt-file-attachment.ts turns it into a synthetic "Access
            // denied" text), so the CLI rejects it up front as a usage error
            // instead of accepting a run the server would sideline.
            // --add-dir only widens tool access, never this check.
            if (!Filesystem.contains(fileBaseDir, resolvedPath)) {
              exitEarly(
                `File outside the current project directory: ${filePath}. ` +
                  "Copy it into the project or pass its content with --prompt-file.",
              )
            }

            const filename = path.basename(resolvedPath)
            // Directories keep their existing classification; files infer the
            // mime type from the extension so binary attachments (images, PDFs)
            // reach the server as their real type instead of text/plain.
            const mime = (await Filesystem.isDir(resolvedPath)) ? "application/x-directory" : runFileMime(filename)

            files.push({
              type: "file",
              url: pathToFileURL(resolvedPath).href,
              filename,
              mime,
            })
          }
        }

        if (!process.stdin.isTTY && !stdinConsumedByPromptFile) {
          message += "\n" + (await readNonTtyStdin())
        }

        if (message.trim().length === 0 && !args.command) {
          exitEarly(missingRunPromptMessage())
        }

        if (args.continue && args.session) {
          exitEarly("--continue and --session are mutually exclusive")
        }

        if (args.runtime && args.attach) {
          exitEarly("--runtime and --attach are mutually exclusive")
        }

        if (args.fork && !args.continue && !args.session) {
          exitEarly("--fork requires --continue or --session")
        }

        if (args["show-history"] && !args.continue && !args.session) {
          exitEarly("--show-history requires --continue or --session")
        }

        if (args["history-limit"] !== undefined && !args["show-history"]) {
          exitEarly("--history-limit requires --show-history")
        }

        if (
          args["history-limit"] !== undefined &&
          (!Number.isInteger(args["history-limit"]) || args["history-limit"] <= 0)
        ) {
          exitEarly("--history-limit must be a positive integer")
        }

        if (args.timeout !== undefined && (!Number.isFinite(args.timeout) || args.timeout <= 0)) {
          exitEarly("--timeout must be a positive number of seconds", "usage")
        }

        // Validate --output-schema before submission: an unreadable, unparseable,
        // or non-object schema file is a usage error now, not a wasted generation
        // that only fails the post-run validation. The parsed schema is also sent
        // to the model (B4) so the server steers and retries toward it; the
        // post-run validation of the assistant message itself stays as backstop.
        let outputFormat: { type: "json_schema"; schema: Record<string, unknown>; retryCount: number } | undefined
        if (args["output-schema"]) {
          const preflight = await preflightRunOutputSchema(callerCwd, args["output-schema"])
          if (!preflight.ok) exitEarly(preflight.message)
          else outputFormat = { type: "json_schema", schema: preflight.schema, retryCount: 2 }
        }

        // --append-system-prompt[-file]: extra text appended after the agent and
        // environment system prompts (PromptInput.system -> userSystem); it can
        // never replace the built-in system prompt.
        if (args["append-system-prompt"] !== undefined && args["append-system-prompt-file"] !== undefined) {
          exitEarly("--append-system-prompt and --append-system-prompt-file are mutually exclusive")
        }
        let appendSystemPrompt: string | undefined
        if (args["append-system-prompt"] !== undefined) {
          const text = args["append-system-prompt"].replace(/\n$/, "")
          if (text.length === 0) exitEarly("--append-system-prompt must not be empty")
          appendSystemPrompt = text
        }
        if (args["append-system-prompt-file"] !== undefined) {
          const file = args["append-system-prompt-file"]
          // @scan-suppress security_scan - The CLI caller explicitly selects this system-prompt file; local filesystem permissions apply.
          const raw = await readFile(path.resolve(callerCwd, file), "utf8").catch((error: unknown) => {
            exitEarly(`Failed to read system prompt file ${file}: ${toErrorMessage(error)}`)
            return ""
          })
          // Editors append one trailing newline; trim exactly one so the file
          // stays byte-identical otherwise.
          const text = raw.replace(/\n$/, "")
          if (text.length === 0) exitEarly(`--append-system-prompt-file ${file} is empty`)
          appendSystemPrompt = text
        }

        // --disallowed-tools: unknown ids are not an error (MCP tool ids are
        // dynamic); under the default format each non-builtin id gets one
        // stderr warning unless --quiet.
        let disallowedTools: Record<string, false> | undefined
        if (args["disallowed-tools"] !== undefined) {
          const rawDisallowed = args["disallowed-tools"]
          disallowedTools = parseDisallowedTools(Array.isArray(rawDisallowed) ? rawDisallowed : [rawDisallowed])
          if (Object.keys(disallowedTools).length === 0) {
            exitEarly("--disallowed-tools must name at least one tool id")
          }
          if (!isRunEventStreamFormat(args.format)) {
            for (const toolID of Object.keys(disallowedTools)) {
              if (!RUN_BUILTIN_TOOL_IDS.has(toolID)) {
                warn(`tool id "${toolID}" is not a built-in tool; it only matches an MCP tool with that id`)
              }
            }
          }
        }

        // E1: --sandbox is a global yargs option (boot.ts) that reaches this
        // handler as args.sandbox. Locally it only seeds
        // AX_CODE_ISOLATION_MODE; the request-level policy below makes it
        // effective on attached servers too — the server applies the stricter
        // of its own mode and this policy, so it can only tighten.
        const sandboxMode = (args as { sandbox?: string }).sandbox
        let isolationPolicy: { mode: "read-only" | "workspace-write" | "full-access"; network: boolean } | undefined
        if (sandboxMode === "read-only" || sandboxMode === "workspace-write" || sandboxMode === "full-access") {
          isolationPolicy = { mode: sandboxMode, network: sandboxMode === "full-access" }
        } else {
          isolationPolicy = undefined
        }

        // E2: arm the --timeout bound before the first SDK call. A black-holed
        // --attach host or a hung bootstrap used to be unbounded because the
        // timer only fired after the session resolved. The timer, the
        // pre/post-session branching, the early terminal result, and the
        // shared abort all live in `lifecycle` now; `using` keeps the disarm
        // on every exit of this scope (early throws included).
        lifecycle.arm()
        using _timeout = defer(() => lifecycle.disarm())

        const rules: Permission.Ruleset = [
          {
            permission: "question",
            action: "deny",
            pattern: "*",
          },
          {
            permission: "plan_exit",
            action: "deny",
            pattern: "*",
          },
          // --disallowed-tools on a NEW session: deny rules cover the whole run
          // (the prompt-body `tools` map below covers resumed sessions).
          ...Object.keys(disallowedTools ?? {}).map((toolID) => ({
            permission: toolID,
            action: "deny" as const,
            pattern: "*",
          })),
          // --add-dir: allow the external_directory permission (asked as a
          // `<dir>/*` glob) for each extra directory and everything under it.
          ...buildAddDirRules(addDirPaths),
        ]

        function title() {
          if (args.title === undefined) return
          if (args.title !== "") return args.title
          return message.slice(0, 50) + (message.length > 50 ? "..." : "")
        }

        // Surface list/fork/create failures instead of swallowing them: without
        // this, a connection failure to the attached server degrades into a
        // misleading "Session not found" because every failed call returns
        // `{ error }` with no data. Throwing lets the handler-level conversion
        // classify the real cause (A4).
        async function latestRootSessionID(sdk: AxCodeClient) {
          const listed = await sdk.session.list(undefined, { signal: lifecycle.signal })
          if (listed.error) throw listed.error
          return listed.data?.find((s) => !s.parentID)?.id
        }

        async function session(sdk: AxCodeClient) {
          const baseID = args.continue ? await latestRootSessionID(sdk) : args.session

          if (baseID && args.fork) {
            const forked = await sdk.session.fork({ sessionID: baseID }, { signal: lifecycle.signal })
            if (forked.error) throw forked.error
            return forked.data?.id
          }

          if (baseID) return baseID

          const name = title()
          const result = await sdk.session.create({ title: name, permission: rules }, { signal: lifecycle.signal })
          if (result.error) throw result.error
          return result.data?.id
        }

        // Token usage of the final assistant message, set while reading the
        // stored final text; undefined when no counts are available.
        let finalUsage: RunUsageTotals | undefined
        // Structured output the server captured via the StructuredOutput tool
        // (`info.structured`), set while reading the stored final text;
        // undefined when the server stored none (see readFinalAssistantText).
        let finalStructured: unknown | undefined

        async function readFinalAssistantText(
          sdk: AxCodeClient,
          sessionID: string,
          assistantMessageID: string | undefined,
          signal: AbortSignal | undefined = lifecycle.signal,
        ): Promise<string | undefined> {
          if (!assistantMessageID) return undefined
          // F9: the read carries the lifecycle signal so a server that hangs
          // after the stream ended cannot keep the process alive; an abort
          // here only leaves usage/structured unknown (the caller's catch
          // treats it as such), it is never a run failure.
          const result = await sdk.session.messages({ sessionID }, signal ? { signal } : undefined)
          // Side-channel: the same fetch carries the token counts for the
          // terminal result event; missing counts leave usage undefined.
          finalUsage = extractRunUsageTotals(result.data, assistantMessageID)
          // Side-channel: the same fetch carries the server-captured
          // structured output when the run steered through it.
          finalStructured = extractRunStructuredOutput(result.data, assistantMessageID)
          return extractRunFinalAssistantText(result.data, assistantMessageID)
        }

        async function executeRun(sdk: AxCodeClient) {
          function tool(part: ToolPart) {
            try {
              const full = Boolean(args.full)
              if (part.tool === "bash") return bash(props<typeof BashTool>(part), full)
              if (part.tool === "glob") return glob(props<typeof GlobTool>(part))
              if (part.tool === "grep") return grep(props<typeof GrepTool>(part))
              if (part.tool === "list") return list(props<typeof ListTool>(part))
              if (part.tool === "read") return read(props<typeof ReadTool>(part))
              if (part.tool === "write") return write(props<typeof WriteTool>(part), full)
              if (part.tool === "webfetch") return webfetch(props<typeof WebFetchTool>(part))
              if (part.tool === "edit") return edit(props<typeof EditTool>(part), full)
              if (part.tool === "codesearch") return codesearch(props<typeof CodeSearchTool>(part))
              if (part.tool === "websearch") return websearch(props<typeof WebSearchTool>(part))
              if (part.tool === "task") return task(props<typeof TaskTool>(part))
              if (part.tool === "todowrite") return todo(props<typeof TodoWriteTool>(part), full)
              if (part.tool === "skill") return skill(props<typeof SkillTool>(part))
              return fallback(part)
            } catch (error) {
              Log.Default.debug("tool renderer fallback", {
                tool: part.tool,
                error: toErrorMessage(error),
                stack: error instanceof Error ? error.stack : undefined,
              })
              return fallback(part)
            }
          }

          function emit(type: string, data: Record<string, unknown>) {
            if (isRunEventStreamFormat(args.format)) {
              process.stdout.write(JSON.stringify({ type, timestamp: Date.now(), sessionID, ...data }) + EOL)
              return true
            }
            return false
          }

          const eventAbort = new AbortController()
          using _events = defer(() => eventAbort.abort())
          // The SSE connect is the first SDK call of the run; the early
          // --timeout (E2) and the signal handlers must be able to cut it
          // too, e.g. for a black-holed attach host. An abort ends the SDK's
          // SSE stream gracefully (the reader is cancelled), so the event
          // loop simply finishes instead of failing.
          // @scan-suppress lifecycle_scan - The scoped eventAbort disposer and closeEvents cancel this subscription on exit.
          const events = await sdk.event.subscribe(undefined, {
            signal: AbortSignal.any([eventAbort.signal, lifecycle.signal]),
          })
          let error: string | undefined
          let finalMessage: string | undefined
          let finalAssistantMessageID: string | undefined
          let submittedMessage: Awaited<ReturnType<typeof sdk.session.prompt>>["data"]
          // Blocked-run accounting: auto-rejected permission asks (including
          // read-only sandbox denials that surface as tool errors) vs tool calls
          // that actually completed a mutation (item: blocked runs exit 3).
          // The accounting's observed-parts set doubles as the drain/replay
          // observed set, so a redelivered final part is a no-op everywhere
          // (G3).
          const accounting = createRunToolAccounting()
          const observedFinalParts = accounting.observedParts
          // Sessions belonging to this run's tree (G1): the main session plus
          // child sessions spawned by the `task` tool (src/tool/task.ts gives
          // each child its own session id and ruleset). A child's permission
          // ask carries the child session id, so matching only the main id
          // would leave the ask unanswered until `--timeout` — the tree is
          // extended from session.created/session.updated events whose
          // parent is already in it, seeded once the main session resolves.
          const sessionTree = new Set<string>()

          const toggles = new Map<string, boolean>()
          const observedCompletedMessages = new Set<string>()
          const observedErrors = new Set<string>()
          let checkDrained: (() => void) | undefined

          async function* finalEvents() {
            if (!submittedMessage) return
            const info = submittedMessage.info
            yield { type: "message.updated" as const, properties: { info } }
            if (info.role === "assistant" && info.error && !observedErrors.has(JSON.stringify(info.error))) {
              yield { type: "session.error" as const, properties: { sessionID, error: info.error } }
            }
            for (const part of submittedMessage.parts) {
              if (observedFinalParts.has(part.id)) continue
              // Control responses persist complete text without streaming timestamps.
              const finalPart =
                part.type === "text" && !part.time?.end
                  ? {
                      ...part,
                      time: { start: part.time?.start ?? info.time.created, end: info.time.completed ?? Date.now() },
                    }
                  : part
              yield { type: "message.part.updated" as const, properties: { part: finalPart } }
            }
          }

          async function loop(source: AsyncIterable<Event>) {
            for await (const event of source) {
              // G1: track child sessions spawned inside this run's tree; their
              // permission asks and tool completions belong to the run even
              // though their session id differs from the main session's.
              if (event.type === "session.created" || event.type === "session.updated") {
                const info = event.properties.info
                if (info.parentID !== undefined && sessionTree.has(info.parentID)) sessionTree.add(info.id)
              }

              if (
                event.type === "message.updated" &&
                event.properties.info.role === "assistant" &&
                event.properties.info.sessionID === sessionID
              ) {
                finalAssistantMessageID = event.properties.info.id
                if (event.properties.info.time?.completed) observedCompletedMessages.add(event.properties.info.id)
                checkDrained?.()
              }

              if (
                event.type === "message.updated" &&
                event.properties.info.role === "assistant" &&
                event.properties.info.sessionID === sessionID &&
                !isRunEventStreamFormat(args.format) &&
                toggles.get("start") !== true
              ) {
                // --quiet drops the header line and the display-name lookup it
                // exists for; the toggle is still set so the check is one-shot.
                if (!quiet) {
                  UI.empty()
                  const agentName = await resolveRunAgentDisplayName({
                    agentName: event.properties.info.agent,
                    attached: Boolean(args.attach),
                    listLocalAgents: () => Agent.list(),
                    listAttachedAgents: () =>
                      sdk.app
                        .agents()
                        .then((result) => result.data ?? [])
                        .catch(() => []),
                  })
                  // The header carries the session id so a multi-turn caller can
                  // resume with --session without switching to --format json.
                  UI.println(`> ${agentName} · ${event.properties.info.modelID} · ${sessionID}`)
                  UI.empty()
                }
                toggles.set("start", true)
              }

              if (event.type === "message.part.updated") {
                const part = event.properties.part
                // G1: parts from any session in the run's tree are accounted
                // for; only the main session's parts are observed for the
                // drain, rendered, or streamed below.
                if (!sessionTree.has(part.sessionID)) continue
                const isMainSession = part.sessionID === sessionID
                if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
                  // G3: the accounting helper owns the observed-parts guard
                  // for settled tool parts, so a redelivered final part never
                  // double-counts a mutation or a denial.
                  accountToolCompletion(accounting, part)
                } else if (
                  ((part.type === "text" || part.type === "reasoning") && part.time?.end) ||
                  part.type === "step-start" ||
                  part.type === "step-finish"
                ) {
                  observedFinalParts.add(part.id)
                }
                checkDrained?.()

                if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
                  if (emit("tool_use", { part })) continue
                  // Child-session tool parts feed the accounting and the
                  // stream above, but are never rendered into the transcript.
                  if (!isMainSession) continue
                  if (part.state.status === "completed") {
                    if (!quiet) tool(part)
                    continue
                  }
                  inline({
                    icon: "✗",
                    title: `${part.tool} failed`,
                  })
                  // Errors always render, even in concise mode; only their line
                  // count is capped (tail) so a huge stack/build log cannot flood
                  // the transcript. --full restores the uncapped error text.
                  if (args.full) {
                    UI.error(part.state.error)
                    continue
                  }
                  const cappedError = tailLines(part.state.error)
                  UI.error(cappedError.text)
                  omittedHint(cappedError)
                }

                // Everything below is main-session scoped: the running-task
                // toggle, step markers, and streamed text/reasoning.
                if (!isMainSession) continue

                if (
                  part.type === "tool" &&
                  part.tool === "task" &&
                  part.state.status === "running" &&
                  !isRunEventStreamFormat(args.format)
                ) {
                  if (toggles.get(part.id) === true) continue
                  if (!quiet) task(props<typeof TaskTool>(part))
                  toggles.set(part.id, true)
                }

                if (part.type === "step-start") {
                  if (emit("step_start", { part })) continue
                }

                if (part.type === "step-finish") {
                  if (emit("step_finish", { part })) continue
                }

                if (part.type === "text" && part.time?.end) {
                  const text = part.text.trim()
                  if (!text) continue
                  finalMessage = text
                  if (emit("text", { part })) continue
                  if (!process.stdout.isTTY) {
                    process.stdout.write(text + EOL)
                    continue
                  }
                  UI.empty()
                  UI.println(text)
                  UI.empty()
                }

                if (part.type === "reasoning" && part.time?.end && args.thinking) {
                  if (emit("reasoning", { part })) continue
                  const text = part.text.trim()
                  if (!text) continue
                  const line = `Thinking: ${text}`
                  if (process.stdout.isTTY) {
                    UI.empty()
                    // Italic routing goes through UI.Style so NO_COLOR or a
                    // non-TTY stderr cannot leak raw escape sequences.
                    UI.println(`${UI.Style.TEXT_DIM}${UI.Style.TEXT_ITALIC}${line}${UI.Style.TEXT_NORMAL}`)
                    UI.empty()
                    continue
                  }
                  process.stdout.write(line + EOL)
                }
              }

              if (event.type === "session.error") {
                const props = event.properties
                if (props.sessionID !== sessionID || !props.error) continue
                if (
                  isRunSelfAbortError(String(props.error.name), {
                    timedOut: lifecycle.timedOut(),
                    cancelled: lifecycle.cancelled(),
                  })
                )
                  continue
                observedErrors.add(JSON.stringify(props.error))
                let err = String(props.error.name)
                if ("data" in props.error && props.error.data && "message" in props.error.data) {
                  err = String(props.error.data.message)
                }
                error = error ? error + EOL + err : err
                if (emit("error", { error: props.error })) continue
                UI.error(err)
              }

              // A goal revision can cancel an older generation and publish idle
              // while this submission is still planning. The synchronous HTTP
              // submission owns completion; keep consuming permission asks until
              // it settles rather than treating any session-wide idle as final.

              if (event.type === "permission.asked") {
                const permission = event.properties
                // G1: asks from any session in the run's tree are
                // auto-rejected (a headless run has no human to answer them);
                // the same reply call works for child asks because it takes
                // the permission request id only.
                if (!sessionTree.has(permission.sessionID)) continue
                accounting.permissionDenials++
                // Stream consumers see the denial as an event before the
                // rejection reaches the server; the event names the asking
                // session, which differs from the main session for child asks.
                // Humans keep the stderr warning.
                emit("permission_denied", {
                  sessionID: permission.sessionID,
                  permission: permission.permission,
                  patterns: permission.patterns,
                })
                warn(
                  `permission requested${permission.sessionID === sessionID ? "" : ` in child session ${permission.sessionID}`}: ` +
                    `${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`,
                )
                await sdk.permission.reply(
                  {
                    requestID: permission.id,
                    reply: "reject",
                  },
                  { signal: lifecycle.signal },
                )
              }
            }
          }

          // Validate agent if specified
          const agent = await (async () => {
            if (!args.agent) return undefined

            // When attaching, validate against the running server instead of local Instance state.
            if (args.attach) {
              const modes = await sdk.app
                .agents(undefined, { throwOnError: true })
                .then((x) => x.data ?? [])
                .catch(() => undefined)

              if (!modes) {
                warn(`failed to list agents from ${args.attach}. Falling back to default agent`)
                return undefined
              }

              const agent = modes.find((a) => a.name === args.agent)
              if (!agent) {
                warn(`agent "${args.agent}" not found. Falling back to default agent`)
                return undefined
              }

              const tier = Agent.resolveTier(agent)
              if (tier === "subagent" || tier === "internal") {
                warn(`agent "${args.agent}" is a ${tier} agent, not a primary agent. Falling back to default agent`)
                return undefined
              }

              return args.agent
            }

            const entry = await Agent.get(args.agent)
            if (!entry) {
              warn(`agent "${args.agent}" not found. Falling back to default agent`)
              return undefined
            }
            const entryTier = Agent.resolveTier(entry)
            if (entryTier === "subagent" || entryTier === "internal") {
              warn(`agent "${args.agent}" is a ${entryTier} agent, not a primary agent. Falling back to default agent`)
              return undefined
            }
            return args.agent
          })()

          // Validate an explicitly requested model before creating a session so a
          // typo'd or removed -m/--model fails fast instead of leaving behind a
          // ghost session that only errors server-side after creation (#405).
          // The model actually sent may differ from the request: a SKU whose
          // native provider is disabled is followed to the connected provider
          // that serves it.
          let runModel: { providerID: string; modelID: string } | undefined
          if (args.model) {
            let providerID: string
            let modelID: string
            try {
              const parsed = Provider.parseModel(args.model)
              providerID = parsed.providerID
              modelID = parsed.modelID
            } catch (error) {
              exitEarly(toErrorMessage(error), "model")
            }
            runModel = { providerID: providerID!, modelID: modelID! }
            const listProviders = (waitForDiscovery = false) =>
              sdk.provider
                .list(
                  undefined,
                  waitForDiscovery
                    ? { headers: { [Provider.DISCOVERY_WAIT_HEADER]: "true" }, signal: lifecycle.signal }
                    : { signal: lifecycle.signal },
                )
                .then((result) =>
                  result.data ? { all: result.data.all, connected: result.data.connected } : undefined,
                )
                .catch((error: unknown) => {
                  // F10: an abort (timeout/signal) must surface, not hide
                  // behind this catch — otherwise the flow enters `execute`
                  // on a cut connection. Real listing failures keep the
                  // warning path below.
                  if (isAbortError(error)) throw error
                  return undefined
                })
            const initialProviders = await listProviders()
            let connected = initialProviders?.connected
            const providers = initialProviders
              ? await refreshRunProvidersOnModelMiss({
                  providers: initialProviders.all,
                  connected,
                  providerID: providerID!,
                  modelID: modelID!,
                  refresh: async () => {
                    // Keep discovery off the fast path for models already present
                    // in the snapshot. Only a miss waits for the complete local or
                    // attached-server list, then validates once more.
                    if (!args.attach) await Provider.ready()
                    const refreshed = await listProviders(Boolean(args.attach))
                    connected = refreshed?.connected
                    return refreshed?.all
                  },
                })
              : undefined
            if (!providers) {
              warn(`failed to list providers; skipping validation for model "${args.model}"`)
            } else {
              const resolved = resolveRunModel({ providers, connected, providerID: providerID!, modelID: modelID! })
              if (!resolved) {
                const modelInput = { providers, providerID: providerID!, modelID: modelID! }
                const modelError = findRunModelError(modelInput)
                if (modelError) exitEarly(modelError, findRunModelErrorCode(modelInput))
                if (connected && !connected.includes(providerID!)) {
                  exitEarly(
                    `Provider "${providerID!}" is not connected. ` +
                      "Connect it with `ax-code providers login`, or pick an ID from `ax-code models`.",
                    "provider",
                  )
                }
              } else if (resolved.providerID !== providerID!) {
                warn(`model "${args.model}" is served as "${resolved.providerID}/${resolved.modelID}"`)
                runModel = resolved
              }
            }
          }

          // Preflight an explicit --session id before creating anything: a typo'd
          // or deleted id must fail fast with a structured session error instead
          // of a late 404 from the submission, which used to escape the handler
          // as an unstructured fatal (A1). Any non-404 failure propagates to the
          // handler-level conversion.
          if (args.session) {
            await sdk.session.get({ sessionID: args.session }, { throwOnError: true, signal: lifecycle.signal }).then(
              () => undefined,
              (error: unknown) => {
                if (errorNameOf(error) === "SessionNotFoundError") {
                  exitEarly(
                    `Session not found: ${args.session}. Run \`ax-code session list --json\` for ids.`,
                    "session",
                  )
                }
                throw error
              },
            )
          }

          const sessionID = (await session(sdk)) ?? exitEarly("Session not found")
          lifecycle.markSession()
          // G1: the main session roots the run's session tree.
          sessionTree.add(sessionID)
          // A pre-session --timeout already emitted the terminal result and cut
          // the SDK calls. `--session` resolves without another SDK call, so
          // without this bail the submission would still proceed and a second
          // result line could follow (the lifecycle's terminal guard blocks
          // the emission, but the submission itself must not run either).
          if (abortState.earlyTimeoutEmitted) {
            return
          }

          // Single abort path shared by the --timeout timer and the signal handlers.
          // Best-effort and never throwing: an already-idle session answers 4xx
          // (silently ignored), and only unexpected server failures get a debug line.
          // F11: the abort request carries its own short timeout signal — never
          // the lifecycle signal — so cutting the pending SDK calls cannot also
          // kill the very request that tells the server to stop.
          // F13: the request is recorded in the lifecycle and awaited before the
          // terminal result is written (and before the handler returns), so the
          // abort is actually delivered — a fire-and-forget request loses the
          // race with process teardown and leaves the generation running.
          serverAbort = (reason) => {
            const request: Promise<void> = sdk.session
              .abort({ sessionID }, { signal: AbortSignal.timeout(RUN_SERVER_ABORT_BOUND_MS) })
              .then((result) => {
                if (result.error && result.response && result.response.status >= 500) {
                  Log.Default.debug("run abort failed", {
                    sessionID,
                    reason,
                    status: result.response.status,
                  })
                }
              })
              .catch(() => {})
            lifecycle.recordServerAbort(request)
          }
          // F3: a timeout or signal that fired while the session was resolving
          // raced a no-op serverAbort (assigned only now); the lifecycle
          // already aborted the pending calls. For a session THIS run created,
          // issue the hygiene abort so the server is not left running an
          // orphaned generation. A resumed session (--session/--continue
          // without --fork) is deliberately left alone: the caller may have
          // live work there that this run never started.
          const sessionCreatedHere = (!args.session && !args.continue) || args.fork === true
          if ((lifecycle.timedOut() || lifecycle.cancelled()) && sessionCreatedHere) {
            serverAbort(lifecycle.timedOut() ? "timeout" : "cancelled")
          }

          if (args["show-history"]) {
            const historyLimit = args["history-limit"]
            const msgsRes = await sdk.session
              .messages({ sessionID }, { signal: lifecycle.signal })
              .catch(() => undefined)
            const msgs = msgsRes?.data ?? []
            const limited = historyLimit !== undefined ? msgs.slice(-historyLimit) : msgs
            if (limited.length > 0) {
              UI.println(
                UI.Style.TEXT_DIM +
                  `── session history (${limited.length} message${limited.length === 1 ? "" : "s"}) ──`,
              )
              for (const entry of limited) {
                const role = entry.info.role === "user" ? "You" : "Assistant"
                const trimmed = entry.parts
                  .filter((p) => p.type === "text" && "text" in p)
                  .map((p) => ("text" in p ? (p as { text: string }).text : ""))
                  .join("")
                  .trim()
                if (trimmed) {
                  UI.println(
                    UI.Style.TEXT_DIM +
                      `[${role}] ` +
                      UI.Style.TEXT_NORMAL +
                      trimmed.slice(0, 200) +
                      (trimmed.length > 200 ? "…" : ""),
                  )
                }
              }
              UI.println(UI.Style.TEXT_DIM + "────────────────────────────────────")
              UI.empty()
            }
          }

          const closeEvents = async () => {
            eventAbort.abort()
            const stream = events.stream as AsyncIterator<unknown>
            await (stream.return?.(undefined) ?? Promise.resolve()).catch(() => {})
          }
          const loopPromise = loop(events.stream)
          // Attach the rejection handler immediately, including while HTTP is pending.
          const loopResult = loopPromise.then(
            () => undefined,
            (error: unknown) => error,
          )

          // The --timeout timer is armed in the handler body before the first
          // SDK call (E2); by this point a firing timer routes through
          // `serverAbort` and the drain/reconciliation path below emits the
          // terminal result with status "timeout".

          // F3: a timeout or signal that fired before the submission goes
          // straight to the terminal result path — the prompt POST is skipped
          // entirely (status timeout/cancelled, exit 124/130, no error event).
          const skipSubmission = lifecycle.timedOut() || lifecycle.cancelled()
          // F4: interactive tools are always disabled per turn. The
          // create-time deny rules only cover new sessions; a resumed
          // --session/--continue session would otherwise still reach the
          // interactive `question`/`plan_exit` tools. Merged with
          // --disallowed-tools (this per-request tools map is deprecated but
          // honored, and is the only mechanism that covers resumed sessions).
          const promptTools: Record<string, false> = { question: false, plan_exit: false, ...disallowedTools }
          try {
            if (!skipSubmission) {
              if (args.command) {
                const response = await sdk.session.command(
                  {
                    sessionID,
                    agent,
                    model: runModel ? `${runModel.providerID}/${runModel.modelID}` : undefined,
                    command: args.command,
                    arguments: message,
                    variant: args.variant,
                  },
                  { throwOnError: true, signal: lifecycle.signal },
                )
                submittedMessage = response.data
              } else {
                const response = await sdk.session.prompt(
                  {
                    sessionID,
                    agent,
                    model: runModel,
                    variant: args.variant,
                    ...(appendSystemPrompt !== undefined ? { system: appendSystemPrompt } : {}),
                    // --disallowed-tools is sent through BOTH mechanisms: the
                    // create-time deny rules cover new sessions, while this
                    // (deprecated but honored) per-request tools map also covers
                    // resumed --session/--continue sessions.
                    tools: promptTools,
                    ...(isolationPolicy !== undefined ? { isolation: isolationPolicy } : {}),
                    ...(outputFormat !== undefined ? { format: outputFormat } : {}),
                    parts: [...files, { type: "text", text: message }],
                  },
                  { throwOnError: true, signal: lifecycle.signal },
                )
                submittedMessage = response.data
              }
            }
          } catch (e) {
            await closeEvents()
            await loopResult
            // An abort this process requested (--timeout or SIGINT) can also
            // surface here: the server settles the submission with a
            // MessageAbortedError, or the lifecycle signal cuts the pending
            // POST and it rejects with an AbortError. Both are the expected
            // outcome, not a failure: fall through to the terminal result
            // path, which reports status timeout/cancelled. Any other error
            // still propagates.
            const selfAbortState = { timedOut: lifecycle.timedOut(), cancelled: lifecycle.cancelled() }
            const selfAbort =
              isRunSelfAbortError(errorNameOf(e), selfAbortState) ||
              ((selfAbortState.timedOut || selfAbortState.cancelled) && isAbortError(e))
            if (!selfAbort) throw e
          }

          // Give final frames on the separate SSE connection a bounded chance to
          // drain. Control commands need not publish idle or streaming text times.
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(finish, 250)
            function finish() {
              clearTimeout(timeout)
              checkDrained = undefined
              resolve()
            }
            checkDrained = () => {
              if (
                submittedMessage &&
                observedCompletedMessages.has(submittedMessage.info.id) &&
                submittedMessage.parts.every((part) => observedFinalParts.has(part.id))
              )
                finish()
            }
            checkDrained()
            void loopResult.then(finish)
          })
          await closeEvents()
          const loopError = await loopResult
          // An AbortError here is the lifecycle signal cutting the SSE read or
          // a pending permission reply after a timeout/signal — expected
          // fallout, not a loop failure (F11).
          const loopSelfAbort =
            loopError !== undefined && (lifecycle.timedOut() || lifecycle.cancelled()) && isAbortError(loopError)
          if (loopError !== undefined && !loopSelfAbort) {
            Log.Default.error("run event loop failed", { sessionID, error: toErrorMessage(loopError) })
            UI.error(`Event stream error: ${toErrorMessage(loopError)}`)
            process.exitCode = 1
          }
          // Reconcile after stream shutdown, even if it ended before HTTP settled.
          await loop(finalEvents())
          const storedFinalMessage = await readFinalAssistantText(sdk, sessionID, finalAssistantMessageID).catch(
            (e) => {
              // F9: an abort here (timeout/signal cut the read) only leaves
              // usage/structured unknown — it is never a run failure.
              if (isAbortError(e)) {
                Log.Default.info("final assistant text read aborted; usage/structured stay unknown", {
                  sessionID,
                  assistantMessageID: finalAssistantMessageID,
                })
                return undefined
              }
              Log.Default.warn("failed to read final assistant text from session messages", {
                sessionID,
                assistantMessageID: finalAssistantMessageID,
                error: toErrorMessage(e),
                stack: e instanceof Error ? e.stack : undefined,
              })
              return undefined
            },
          )
          // --output-schema: the server steers the model through a
          // StructuredOutput tool and stores the captured object on the final
          // assistant message; that message usually has no text part at all.
          // The serialized object is the final text everywhere — stdout,
          // --output-file, the terminal result event, and the post-run schema
          // validation (which re-validates the same value the server already
          // accepted). The stored/streamed text part stays the fallback for
          // servers that do not store `structured`.
          const structuredText =
            outputFormat !== undefined && finalStructured !== undefined ? JSON.stringify(finalStructured) : undefined
          const finalText = structuredText ?? storedFinalMessage ?? finalMessage
          try {
            await handleRunStructuredOutput(finalText, {
              callerCwd,
              outputFile: args["output-file"],
              outputSchema:
                outputFormat !== undefined && args["output-schema"] !== undefined
                  ? { file: args["output-schema"], parsed: outputFormat.schema }
                  : undefined,
            })
            // Default format: the serialized structured object is the final
            // stdout text (same TTY/non-TTY split as streamed text parts);
            // stream formats carry it on the terminal result event instead.
            if (structuredText !== undefined && !isRunEventStreamFormat(args.format)) {
              if (!process.stdout.isTTY) {
                process.stdout.write(structuredText + EOL)
              } else {
                UI.empty()
                UI.println(structuredText)
                UI.empty()
              }
            }
          } catch (e) {
            // F1: record the failure so the terminal result reports "error"
            // and the exit-code precedence keeps 1 instead of downgrading to
            // 130/124/3. Stream formats also get one structured error event
            // (before the terminal result line).
            const outputMessage = e instanceof Error ? e.message : String(e)
            error = error ? error + EOL + outputMessage : outputMessage
            emit("error", { error: { name: "StructuredOutputError", data: { message: outputMessage } } })
            UI.error(outputMessage)
            process.exitCode = 1
          }
          if (error) process.exitCode = 1

          // F13: a server abort issued by --timeout/SIGINT must be delivered
          // before the run reports its terminal outcome — waiting here, instead
          // of firing the request and forgetting it, is what actually stops a
          // real server's generation before the process exits. The wait is
          // bounded by the request's own short timeout signal (F11) and never
          // rejects; it resolves immediately when no abort was issued. It sits
          // before the outcome computation so a timer firing during the wait
          // cannot produce a stale verdict — the precedence rules below still
          // decide between timeout and cancelled afterwards.
          await lifecycle.awaitServerAbort()

          // Terminal result line for stream consumers. Emitted after every other
          // stdout write so it is always the last line of the run, exactly once
          // even when the SSE stream ended early and the final reconciliation
          // replayed the remaining frames (the lifecycle's terminal guard makes
          // the exactly-once rule structural). Exit-code precedence (highest
          // first): a real error (1) beats a SIGINT cancel (130), which beats a
          // timeout (124), which beats a blocked run (3); success is 0. The
          // rule lives in the lifecycle module (unit-tested in
          // run-lifecycle.test.ts).
          const runFailed = error !== undefined || (loopError !== undefined && !loopSelfAbort)
          const runBlocked = !runFailed && isBlockedRun(accounting.permissionDenials, accounting.successfulMutations)
          const runExitCode = lifecycle.exitCode({ failed: runFailed, blocked: runBlocked })
          if (runExitCode !== undefined) process.exitCode = runExitCode
          if (lifecycle.terminal() || !isRunEventStreamFormat(args.format)) return
          lifecycle.markTerminal()
          process.stdout.write(
            JSON.stringify(
              buildRunResultEvent({
                timestamp: Date.now(),
                sessionID,
                status: resolveRunResultStatus({
                  failed: runFailed,
                  blocked: runBlocked,
                  timedOut: lifecycle.timedOut(),
                  cancelled: lifecycle.cancelled(),
                }),
                text: finalText ?? "",
                permissionDenials: accounting.permissionDenials,
                usage: finalUsage,
              }),
            ) + EOL,
          )
        }

        // F2: the run body settles here — success or failure — so the
        // --timeout timer is cleared (and its handler neutered) the moment
        // `executeRun` finishes. Without this, a timer firing during the
        // post-run teardown (scheduled-task notice, bootstrap shutdown) could
        // overwrite a successful exit code with 124 or re-abort an
        // already-completed session.
        async function execute(sdk: AxCodeClient) {
          try {
            await executeRun(sdk)
          } finally {
            // F2: settle first so the timeout timer is disarmed and neutered
            // before the (bounded) wait below — a timer firing during the
            // wait could otherwise overwrite a committed cancel exit code.
            lifecycle.settle()
            // F13: every return path — including throws that never reach the
            // terminal emission above — waits for an issued server abort to
            // settle before the handler returns; the wait is bounded by the
            // request's own short timeout signal and resolves immediately
            // when no abort was issued.
            await lifecycle.awaitServerAbort()
          }
        }

        // E1: --runtime resolves the managed runtime record of the project
        // directory into the same attach shape as --attach (base URL + headers).
        // The record URL is loopback-validated by RuntimeRegistry's schema, so no
        // separate assertLoopbackHttpUrl is needed here.
        if (args.runtime) {
          const { RuntimeRegistry } = await import("../../runtime/runtime-registry")
          const status = await RuntimeRegistry.status(runtimeDirectory)
          if (status.state === "running" && status.record) {
            runtimeAttach = {
              baseUrl: status.record.url.replace(/\/$/, ""),
              headers: { ...buildAttachAuthHeaders(args.password), ...RuntimeRegistry.headers(status.record) },
              directory: status.record.directory,
            }
          } else {
            exitEarly(
              `No running managed runtime for ${status.directory}. Start one with \`ax-code runtime start --dir ${status.directory}\`.`,
              "attach",
            )
          }
        }

        // Register the signal handlers only after every early-exit validation has
        // passed, so the `finally` below always pairs the registration with its
        // removal and no early-return path leaks a listener.
        process.once("SIGINT", onRunSignal)
        process.once("SIGTERM", onRunSignal)

        try {
          if (args.attach) {
            assertLoopbackHttpUrl(args.attach, "--attach URL")
            await pathDisplayRootContext.run(pathDisplayRoot, async () => {
              const headers = buildAttachHeaders({ password: args.password })
              const sdk = createAxCodeClient({ baseUrl: args.attach, directory, headers })
              await execute(sdk)
            })
            return
          }

          if (runtimeAttach) {
            const attach = runtimeAttach
            await pathDisplayRootContext.run(pathDisplayRoot, async () => {
              const sdk = createAxCodeClient({
                baseUrl: attach.baseUrl,
                directory: attach.directory,
                headers: attach.headers,
              })
              await execute(sdk)
            })
            return
          }

          await pathDisplayRootContext.run(pathDisplayRoot, async () => {
            await bootstrap(runtimeDirectory, async () => {
              const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
                const request = new Request(input, init)
                const url = new URL(request.url)
                if (!isInternalHostname(url.hostname)) throw new Error(`Internal fetch rejected: ${url.hostname}`)
                ServerRuntimeAuth.apply(request.headers)
                // @scan-suppress security_scan - This calls the in-process Hono app after the internal-host check, not a network fetch.
                return Server.Default().fetch(request)
              }) as typeof globalThis.fetch
              const sdk = createAxCodeClient({
                baseUrl: internalBaseUrl(),
                fetch: fetchFn,
                directory: runtimeDirectory,
              })
              await execute(sdk)
              // Still inside the bootstrap context so ScheduledTask.list can read
              // the project store; must never throw on the way out.
              await printPendingScheduledTaskNotice(args.format)
            })
          })
        } finally {
          process.removeListener("SIGINT", onRunSignal)
          process.removeListener("SIGTERM", onRunSignal)
          if (process.cwd() !== previousCwd) {
            try {
              process.chdir(previousCwd)
            } catch {}
          }
        }
      },
      () => runtimeAttach?.baseUrl ?? args.attach,
      // G2/G6: a terminal line was already written (result or error), or the
      // exit code was committed by the --timeout timer / a signal — later
      // rejections are teardown fallout and must not write a second terminal
      // line or flip the committed exit code.
      () => lifecycle.terminal() || lifecycle.timedOut() || lifecycle.cancelled(),
    )
  },
})
