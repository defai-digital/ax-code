import { which } from "../../util/which"
import { CliLanguageModel, cliEnv } from "./cli-language-model"
import { getCliProviderDefinition, type CliProviderDefinition } from "./config"
import { resolveCliModel, type CliModelInfo } from "./resolve"
import { Process } from "../../util/process"
import { Log } from "../../util/log"
import { parseCliJsonEventLine } from "./parser"

export const CLI_CONNECT_TIMEOUT_MS = 15_000
const CLI_CONNECT_PROMPT = "Reply with exactly OK."
const log = Log.create({ service: "provider.cli.connect" })

function isClaudeAuthFailure(event: unknown) {
  if (!event || typeof event !== "object") return false
  const record = event as Record<string, unknown>
  if (record.type !== "error" && record.error === undefined) return false

  const error = record.error
  if (error === "authentication_failed") return true
  if (typeof error === "string") return error.toLowerCase().includes("auth")
  if (!error || typeof error !== "object") return false

  const errorRecord = error as Record<string, unknown>
  const type = typeof errorRecord.type === "string" ? errorRecord.type.toLowerCase() : ""
  const code = typeof errorRecord.code === "string" ? errorRecord.code.toLowerCase() : ""
  const message = typeof errorRecord.message === "string" ? errorRecord.message.toLowerCase() : ""
  return [type, code, message].some((value) => value.includes("auth") || value.includes("login"))
}

async function checkClaudeAuth(binary: string): Promise<string | undefined> {
  try {
    const out = await Process.run([binary, "--print", "--verbose", "--output-format", "stream-json", "ping"], {
      stdin: "ignore",
      env: cliEnv([], "claude-code"),
      abort: AbortSignal.timeout(5_000),
      nothrow: true,
    })

    for (const line of [out.stdout, out.stderr]
      .map((chunk) => chunk.toString())
      .join("\n")
      .split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed[0] !== "{") continue
      const event = parseCliJsonEventLine(line)
      if (!event) {
        log.debug("claude auth probe ignored non-JSON event line", {
          command: "provider.cli.auth_probe",
          status: "ignored",
          binary,
          line: trimmed.slice(0, 200),
        })
        continue
      }
      if (isClaudeAuthFailure(event)) {
        return "Claude CLI is not logged in. Run `claude login` first, then retry `ax-code providers login --provider claude-code`."
      }
    }

    return
  } catch (error) {
    log.debug("claude auth probe failed", {
      command: "provider.cli.auth_probe",
      status: "error",
      binary,
      error,
    })
    return
  }
}

export async function checkCliProviderAuth(providerID: string, binary: string): Promise<string | undefined> {
  if (providerID === "claude-code") return checkClaudeAuth(binary)
  return
}

export interface CliProviderProbeResult {
  binary: string
  model: CliModelInfo
}

export interface CliLanguageModelProbeConfig {
  providerID: string
  modelID: string
  binary: string
  providerEnvKeys?: readonly string[]
  args?: string[]
  parser?: CliProviderDefinition["parser"]
  promptMode?: CliProviderDefinition["promptMode"]
  promptFlag?: string
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
          parser: config.parser,
          promptMode: config.promptMode,
          promptFlag: config.promptFlag,
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
    parser: resolved.parser,
    providerEnvKeys: config.providerEnvKeys,
    promptMode: resolved.promptMode,
    promptFlag: resolved.promptFlag,
  })

  const abortSignal = AbortSignal.timeout(CLI_CONNECT_TIMEOUT_MS)
  await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: CLI_CONNECT_PROMPT }] }],
    abortSignal,
  })
}

export async function probeCliProvider(providerID: string): Promise<CliProviderProbeResult> {
  const definition = getCliProviderDefinition(providerID)
  if (!definition) throw new Error(`Unsupported CLI provider: ${providerID}`)

  const binary = which(definition.binary)
  if (!binary) throw new Error(`${definition.binary} CLI not found in PATH`)

  const model = await resolveCliModel(providerID)
  await probeCliLanguageModel({
    providerID,
    modelID: model.model,
    binary,
  })

  return { binary, model }
}
