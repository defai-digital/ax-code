import { toErrorMessage } from "../../util/error-message"
import { CliLanguageModel, cliEnv } from "./cli-language-model"
import { getCliProviderDefinition, type CliProviderDefinition } from "./config"
import { resolveCliBinary } from "./resolve-binary"
import { resolveCliModel, type CliModelInfo } from "./resolve"
import { Process } from "../../util/process"
import { Log } from "../../util/log"
import { parseCliJsonObject, type CliJsonObject } from "./json"

export const CLI_CONNECT_TIMEOUT_MS = 15_000
const CLI_STATUS_TIMEOUT_MS = 5_000
const CLI_CONNECT_PROMPT = "Reply with exactly OK."
const log = Log.create({ service: "provider.cli.connect" })

/**
 * Free, non-inference login status. Discovery and first model load rely on
 * this so listing models never spends a paid request.
 */
export type CliProviderAuthState = "authenticated" | "unauthenticated" | "unverified" | "unsupported"

export interface CliProviderAuthStatus {
  state: CliProviderAuthState
  binary: string
  message?: string
}

type CliStatusKind = "claude" | "codex"

const CLI_STATUS_COMMANDS: Record<string, { kind: CliStatusKind; args: readonly string[] }> = {
  // `claude auth status --json` prints {"loggedIn": boolean, "authMethod": ...}
  // and exits non-zero when signed out.
  "claude-code": { kind: "claude", args: ["auth", "status", "--json"] },
  // `codex login status` prints "Logged in using ..." and exits non-zero when
  // not logged in.
  "codex-cli": { kind: "codex", args: ["login", "status"] },
}

const CLI_LABELS: Record<string, string> = {
  "claude-code": "Claude",
  "codex-cli": "Codex",
}

function notLoggedInMessage(providerID: string, binary: string) {
  const label = CLI_LABELS[providerID] ?? providerID
  return `${label} CLI is not logged in. Run \`${binary} login\` first, then retry \`ax-code providers login --provider ${providerID}\`.`
}

function parseClaudeLoggedIn(output: string): boolean | undefined {
  const candidates = [output.trim(), ...output.split("\n").map((line) => line.trim())]
  for (const candidate of candidates) {
    if (!candidate || candidate[0] !== "{") continue
    const parsed: CliJsonObject | undefined = parseCliJsonObject(candidate)
    if (parsed && typeof parsed.loggedIn === "boolean") return parsed.loggedIn
  }
  return undefined
}

function parseCodexLoggedIn(code: number, output: string): boolean | undefined {
  const text = output.toLowerCase()
  if (code !== 0) return false
  if (/not logged in|signed out|please (log ?in|sign ?in)/.test(text)) return false
  if (/logged in|signed in/.test(text)) return true
  return undefined
}

async function readCliStatus(
  providerID: string,
  binary: string,
  command: { kind: CliStatusKind; args: readonly string[] },
): Promise<{ code: number; output: string } | undefined> {
  try {
    const result = await Process.run([binary, ...command.args], {
      stdin: "ignore",
      env: cliEnv([], providerID),
      abort: AbortSignal.timeout(CLI_STATUS_TIMEOUT_MS),
      nothrow: true,
      // Best-effort probe: discovery fires this in the background during
      // shutdown, so it must not keep a short-lived CLI process alive.
      unref: true,
    })
    return {
      code: result.code,
      output: [result.stdout, result.stderr].map((chunk) => chunk.toString()).join("\n"),
    }
  } catch (error) {
    log.debug("cli provider status probe failed", {
      command: "provider.cli.status_probe",
      status: "error",
      providerID,
      binary,
      error: toErrorMessage(error),
    })
    return undefined
  }
}

/**
 * Free login check for providers whose CLI exposes a status command. Providers
 * without one report `unsupported` and callers must not infer from this that
 * the user is signed in or out.
 */
export async function checkCliProviderStatus(providerID: string, binary: string): Promise<CliProviderAuthStatus> {
  const command = Object.hasOwn(CLI_STATUS_COMMANDS, providerID) ? CLI_STATUS_COMMANDS[providerID] : undefined
  if (!command) return { state: "unsupported", binary }

  const result = await readCliStatus(providerID, binary, command)
  if (!result) return { state: "unverified", binary }

  const loggedIn =
    command.kind === "claude" ? parseClaudeLoggedIn(result.output) : parseCodexLoggedIn(result.code, result.output)

  if (loggedIn === true) return { state: "authenticated", binary }
  // `claude auth status` exits non-zero when signed out, even when it prints no
  // parseable JSON. Codex's parser already folds a non-zero exit into `false`.
  if (loggedIn === false || (command.kind === "claude" && result.code !== 0)) {
    return { state: "unauthenticated", binary, message: notLoggedInMessage(providerID, binary) }
  }
  // Unknown output shape: not proof of a signed-out user. Callers treat this as
  // "unverified" and must not fail the provider.
  return { state: "unverified", binary }
}

/**
 * Auth hint used by discovery and model loading. Returns an actionable message
 * only for a definitive signed-out status; unknown status stays unverified.
 */
export async function checkCliProviderAuth(providerID: string, binary: string): Promise<string | undefined> {
  const status = await checkCliProviderStatus(providerID, binary)
  return status.state === "unauthenticated" ? status.message : undefined
}

export interface CliProviderProbeResult {
  binary: string
  model: CliModelInfo
  /** True when login was verified by the CLI's status command or a live probe. */
  verified: boolean
}

export interface CliLanguageModelProbeConfig {
  providerID: string
  modelID: string
  binary: string
  providerEnvKeys?: readonly string[]
  args?: string[]
  optionalArgs?: string[]
  parser?: CliProviderDefinition["parser"]
  promptMode?: CliProviderDefinition["promptMode"]
  promptFlag?: string
  workspaceArg?: string
  authCheck?: (providerID: string, binary: string) => Promise<string | undefined>
}

export async function probeCliLanguageModel(config: CliLanguageModelProbeConfig) {
  const definition = getCliProviderDefinition(config.providerID)
  const resolved =
    definition ??
    (config.args && config.parser && config.promptMode
      ? {
          binary: config.binary,
          args: config.args,
          optionalArgs: config.optionalArgs,
          parser: config.parser,
          promptMode: config.promptMode,
          promptFlag: config.promptFlag,
          workspaceArg: config.workspaceArg,
        }
      : undefined)
  if (!resolved) throw new Error(`Unsupported CLI provider: ${config.providerID}`)

  const authError = await (config.authCheck ?? checkCliProviderAuth)(config.providerID, config.binary)
  if (authError) throw new Error(authError)

  const model = new CliLanguageModel({
    providerID: config.providerID,
    modelID: config.modelID,
    binary: config.binary,
    args: resolved.args,
    optionalArgs: resolved.optionalArgs,
    parser: resolved.parser,
    providerEnvKeys: config.providerEnvKeys,
    promptMode: resolved.promptMode,
    promptFlag: resolved.promptFlag,
    workspaceArg: resolved.workspaceArg,
  })

  const abortSignal = AbortSignal.timeout(CLI_CONNECT_TIMEOUT_MS)
  try {
    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: CLI_CONNECT_PROMPT }] }],
      abortSignal,
    })
  } catch (error) {
    // A raw stream error ("Premature close") or timeout gives the user nothing
    // to act on. Those shapes almost always mean the CLI sat waiting for an
    // interactive login/consent prompt it could not show in headless mode.
    const message = toErrorMessage(error)
    const opaque = abortSignal.aborted || /premature close|timed? ?out|abort/i.test(message)
    const hint = opaque
      ? ` — the CLI produced no usable output within ${Math.round(CLI_CONNECT_TIMEOUT_MS / 1000)}s; it may need a one-time interactive run or login (run \`${config.binary}\` in a terminal first, then retry)`
      : ""
    throw new Error(`${config.providerID} CLI probe failed: ${message}${hint}`)
  }
}

/**
 * Explicit login/connect check. Uses the free status command when the CLI has
 * one; otherwise validates the bridge with exactly one inference probe. The
 * probe and the runtime both resolve the binary through `resolveCliBinary` so
 * they run the same executable.
 */
export async function probeCliProvider(providerID: string): Promise<CliProviderProbeResult> {
  const definition = getCliProviderDefinition(providerID)
  if (!definition) throw new Error(`Unsupported CLI provider: ${providerID}`)

  const binary = await resolveCliBinary(providerID, definition.binary)
  if (!binary) throw new Error(`${definition.binary} CLI not found in PATH`)

  const model = await resolveCliModel(providerID)
  const status = await checkCliProviderStatus(providerID, binary)
  if (status.state === "unauthenticated") throw new Error(status.message)

  // Claude and Codex expose a definitive status command. Once it passes, do
  // not spend inference; unknown output stays "unverified" rather than failing.
  if (status.state === "authenticated" || providerID === "claude-code" || providerID === "codex-cli") {
    return { binary, model, verified: status.state === "authenticated" }
  }

  await probeCliLanguageModel({
    providerID,
    modelID: model.model,
    binary,
  })
  return { binary, model, verified: true }
}
