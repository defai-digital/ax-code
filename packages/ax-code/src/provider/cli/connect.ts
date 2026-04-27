import { which } from "../../util/which"
import { CliLanguageModel, cliEnv } from "./cli-language-model"
import { getCliProviderDefinition, type CliProviderDefinition } from "./config"
import { resolveCliModel, type CliModelInfo } from "./resolve"
import { Process } from "../../util/process"

export const CLI_CONNECT_TIMEOUT_MS = 15_000
const CLI_CONNECT_PROMPT = "Reply with exactly OK."

async function checkClaudeAuth(binary: string): Promise<string | undefined> {
  try {
    const out = await Process.run([binary, "--print", "--output-format", "stream-json", "ping"], {
      stdin: "ignore",
      env: cliEnv(),
      timeout: 5_000,
      nothrow: true,
    })

    for (const line of out.stdout.toString().split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed[0] !== "{") continue
      try {
        const event = JSON.parse(trimmed)
        if (event.type === "system" && event.apiKeySource === "none") {
          return "claude CLI is not logged in — run `claude login` first"
        }
        if (event.type === "error" && event.error === "authentication_failed") {
          return "claude CLI is not logged in — run `claude login` first"
        }
      } catch {}
    }

    return
  } catch {
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
