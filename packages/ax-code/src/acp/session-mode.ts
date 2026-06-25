import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Config } from "@/config/config"
import type { ACPConfig } from "./types"
import { ACPSessionManager } from "./session"
import { Agent as AgentModule } from "@/agent/agent"
import { providerModelKey } from "@/provider/model-key"
import {
  buildAvailableModels,
  buildVariantMeta,
  defaultModel,
  formatModelIdWithVariant,
  modelVariantsFromProviders,
  sortProvidersByName,
} from "./agent-adapter"
import { Log } from "@/util/log"

const log = Log.create({ service: "acp-session-mode" })

type ModeOption = { id: string; name: string; description?: string }

export async function loadAvailableModes(sdk: ACPConfig["sdk"], directory: string): Promise<ModeOption[]> {
  const resp = await sdk.app.agents(
    {
      directory,
    },
    { throwOnError: true },
  )
  const agents = resp.data
  if (!agents) throw new Error(`ACP loadAvailableModes: empty agents response for ${directory}`)

  return agents
    .filter((agent) => {
      const tier = AgentModule.resolveTier(agent)
      return tier === "core" || tier === "specialist"
    })
    .map((agent) => ({
      id: agent.name,
      name: agent.name,
      description: agent.description,
    }))
}

async function resolveModeState(
  sdk: ACPConfig["sdk"],
  sessionManager: ACPSessionManager,
  directory: string,
  sessionId: string,
): Promise<{ availableModes: ModeOption[]; currentModeId?: string }> {
  const availableModes = await loadAvailableModes(sdk, directory)
  const existing = sessionManager.get(sessionId)
  const currentModeId =
    existing?.modeId ||
    (await (async () => {
      if (!availableModes.length) return undefined
      const defaultAgentName = await AgentModule.defaultAgent()
      const resolvedModeId =
        availableModes.find((mode) => mode.name === defaultAgentName)?.id ?? availableModes[0].id
      sessionManager.setMode(sessionId, resolvedModeId)
      return resolvedModeId
    })())

  return { availableModes, currentModeId }
}

export async function loadSessionMode(
  params: {
    cwd: string
    mcpServers: import("@agentclientprotocol/sdk").McpServer[]
    sessionId: string
  },
  config: ACPConfig,
  connection: AgentSideConnection,
  sessionManager: ACPSessionManager,
  pendingSessionUpdates: Set<ReturnType<typeof setTimeout>>,
  eventAbort: AbortController,
): Promise<{
  sessionId: string
  models: {
    currentModelId: string
    availableModels: ReturnType<typeof buildAvailableModels>
  }
  modes?: { availableModes: ModeOption[]; currentModeId: string }
  _meta: ReturnType<typeof buildVariantMeta>
}> {
  const directory = params.cwd
  const model = await defaultModel(config, directory)
  const sessionId = params.sessionId

  const providersResp = await config.sdk.config.providers({ directory }, { throwOnError: true })
  if (!providersResp.data?.providers)
    throw new Error(`ACP loadSessionMode: empty providers response for ${directory}`)
  const providers = providersResp.data.providers
  const entries = sortProvidersByName(providers)
  const availableVariants = modelVariantsFromProviders(entries, model)
  const currentVariant = sessionManager.getVariant(sessionId)
  if (currentVariant && !availableVariants.includes(currentVariant)) {
    sessionManager.setVariant(sessionId, undefined)
  }
  const availableModels = buildAvailableModels(entries, { includeVariants: true })
  const modeState = await resolveModeState(config.sdk, sessionManager, directory, sessionId)
  const currentModeId = modeState.currentModeId
  const modes = currentModeId
    ? {
        availableModes: modeState.availableModes,
        currentModeId,
      }
    : undefined

  const commands = await config.sdk.command
    .list(
      {
        directory,
      },
      { throwOnError: true },
    )
    .then((resp) => {
      if (!resp.data) throw new Error("command.list returned empty data")
      return resp.data
    })

  const availableCommands = commands.map((command) => ({
    name: command.name,
    description: command.description ?? "",
  }))
  const names = new Set(availableCommands.map((c) => c.name))
  if (!names.has("compact"))
    availableCommands.push({
      name: "compact",
      description: "compact the session",
    })

  const mcpServers: Record<string, Config.Mcp> = {}
  for (const server of params.mcpServers) {
    if ("url" in server) {
      mcpServers[server.name] = {
        url: server.url,
        headers: server.headers.reduce<Record<string, string>>((acc: Record<string, string>, h: { name: string; value: string }) => {
          acc[h.name] = h.value
          return acc
        }, {}),
        type: "remote",
      }
    } else {
      mcpServers[server.name] = {
        type: "local",
        command: [server.command, ...server.args],
        environment: server.env.reduce<Record<string, string>>((acc: Record<string, string>, e: { name: string; value: string }) => {
          acc[e.name] = e.value
          return acc
        }, {}),
      }
    }
  }

  await Promise.all(
    Object.entries(mcpServers).map(async ([key, mcp]) => {
      await config.sdk.mcp
        .add(
          {
            directory,
            name: key,
            config: mcp,
          },
          { throwOnError: true },
        )
        .catch((error) => {
          log.error("failed to add mcp server", { name: key, error })
        })
    }),
  )

  // Defer the sessionUpdate until after the enclosing create
  // response returns so the ACP client sees the session id
  // before the "available_commands_update" event. Track the
  // timer so dispose() can cancel it, and guard the callback
  // against firing post-dispose — otherwise a rapid
  // create/close cycle can call sessionUpdate on a closed
  // connection.
  const sessionUpdateTimer = setTimeout(() => {
    pendingSessionUpdates.delete(sessionUpdateTimer)
    if (eventAbort.signal.aborted) return
    void connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands,
        },
      })
      .catch((error) => {
        log.error("failed to send available_commands_update", { sessionId, error })
      })
  }, 0)
  pendingSessionUpdates.add(sessionUpdateTimer)

  return {
    sessionId,
    models: {
      currentModelId: formatModelIdWithVariant(model, currentVariant, availableVariants, true),
      availableModels,
    },
    modes,
    _meta: buildVariantMeta({
      model,
      variant: sessionManager.getVariant(sessionId),
      availableVariants,
    }),
  }
}
