import { toErrorMessage } from "../../util/error-message"
import { which } from "../../util/which"
import { CliLanguageModel } from "./cli-language-model"
import { getCliProviderDefinition, type CliProviderDefinition } from "./config"
import { resolveCliModel, type CliModelInfo } from "./resolve"
import { Log } from "../../util/log"

export const CLI_CONNECT_TIMEOUT_MS = 15_000
const CLI_CONNECT_PROMPT = "Reply with exactly OK."
const log = Log.create({ service: "provider.cli.connect" })

// Pre-flight login probe hook. No bundled CLI needs one today: each surfaces
// missing credentials through its own run output, which the connect probe sees.
export async function checkCliProviderAuth(providerID: string, binary: string): Promise<string | undefined> {
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
