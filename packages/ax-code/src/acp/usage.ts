import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { AssistantMessage, AxCodeClient, SessionMessageResponse } from "@ax-code/sdk/v2"
import { ProviderID, ModelID } from "@/provider/schema"
import { Log } from "@/util/log"

const log = Log.create({ service: "acp-usage" })

async function getContextLimit(
  sdk: AxCodeClient,
  providerID: ProviderID,
  modelID: ModelID,
  directory: string,
): Promise<number | null> {
  const providers = await sdk.config
    .providers({ directory })
    .then((x) => x.data?.providers ?? [])
    .catch((error) => {
      log.error("failed to get providers for context limit", { error })
      return []
    })

  const provider = providers.find((p) => p.id === providerID)
  const model = provider?.models[modelID]
  return model?.limit.context ?? null
}

export async function sendUsageUpdate(
  connection: AgentSideConnection,
  sdk: AxCodeClient,
  sessionID: string,
  directory: string,
): Promise<void> {
  const messages = await sdk.session
    .messages({ sessionID, directory }, { throwOnError: true })
    .then((x) => x.data)
    .catch((error) => {
      log.error("failed to fetch messages for usage update", { error })
      return undefined
    })

  if (!messages) return

  const assistantMessages = messages.filter(
    (m): m is { info: AssistantMessage; parts: SessionMessageResponse["parts"] } => m.info.role === "assistant",
  )

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  if (!lastAssistant) return

  const msg = lastAssistant.info
  if (!msg.providerID || !msg.modelID) return
  const size = await getContextLimit(sdk, ProviderID.make(msg.providerID), ModelID.make(msg.modelID), directory)

  if (!size) {
    // Cannot calculate usage without known context size
    return
  }

  // Cache-read AND cache-write are prompt-side tokens; every other place that
  // sums this quantity (processor-impl, token-ledger, compaction-budget,
  // acp/prompt.ts) includes cache write, or the client's context gauge is low.
  // `msg.tokens` accumulates every step of the turn, so prefer the newest
  // step-finish part: its tokens are that step's own prompt — the live window —
  // while the accumulated total overstates a turn that called tools.
  const lastStep = lastAssistant.parts.findLast((part) => part.type === "step-finish")
  const tokens = lastStep?.type === "step-finish" ? lastStep.tokens : msg.tokens
  const used = tokens.input + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)

  await connection
    .sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "usage_update",
        used,
        size,
      },
    })
    .catch((error) => {
      log.error("failed to send usage update", { error })
    })
}
