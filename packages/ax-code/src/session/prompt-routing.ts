import { Agent } from "../agent/agent"
import { classifyComplexity, route as routeAgent } from "../agent/router"
import { Bus } from "../bus"
import { NotificationEvent } from "@/notification/events"
import { Config } from "../config/config"
import { Hybrid } from "../mode/hybrid"
import type { ModePolicy } from "../mode/policy"
import { Provider } from "../provider/provider"
import { modelSelectableForProvider } from "../provider/model-selectability"
import { ModelID, ProviderID } from "../provider/schema"
import { AX_ENGINE_PROVIDER_ID } from "@/provider/ax-engine/constants"
import { Recorder } from "../replay/recorder"
import { Log } from "../util/log"
import { MessageID, SessionID } from "./schema"
import { agentInfo } from "./prompt-agent-model-info"

const log = Log.create({ service: "session.prompt" })

type PromptRoutePart = {
  type: string
}

type PromptRouteModel = {
  providerID: ProviderID
  modelID: ModelID
}

export async function resolveUserMessageRouting(input: {
  sessionID: SessionID
  messageID: MessageID
  agentName: string
  messageText: string
  parts: readonly PromptRoutePart[]
  agentRouting?: "auto" | "preserve"
  requestedModel?: PromptRouteModel
}) {
  let agentName = input.agentName
  const cfg = await Config.get()
  const hasAgentPart = input.parts.some((part) => part.type === "agent")
  const routingDisabled = cfg.routing?.disable === true
  const preserveAgent = input.agentRouting === "preserve"

  if (input.messageText && !preserveAgent && !hasAgentPart && !routingDisabled) {
    const routeResult = routeAgent(input.messageText, agentName)
    if (routeResult) {
      const routedAgent = await Agent.get(routeResult.agent).catch(() => undefined)
      if (routedAgent) {
        const routedLabel = routedAgent.displayName ?? routeResult.agent
        Recorder.emit({
          type: "agent.route",
          sessionID: input.sessionID,
          messageID: input.messageID,
          fromAgent: agentName,
          toAgent: routeResult.agent,
          confidence: routeResult.confidence,
          routeMode: "switch",
          matched: routeResult.matched,
        })
        agentName = routeResult.agent
        log.info("auto-routed to agent", {
          command: "session.prompt.route",
          status: "ok",
          sessionID: input.sessionID,
          agent: routeResult.agent,
          confidence: routeResult.confidence,
        })
        Bus.publishDetached(NotificationEvent.ToastShow, {
          title: "Agent Auto-Switched",
          message: `Switched to "${routedLabel}" agent for this task`,
          variant: "info",
          duration: 5000,
        })
      } else {
        log.warn("auto-route target not found", { agent: routeResult.agent })
      }
    }
  }

  const messageComplexity = input.messageText ? (await classifyComplexity(input.messageText)).complexity : null
  const agent = await agentInfo({ sessionID: input.sessionID, name: agentName })
  let complexityModel: PromptRouteModel | undefined
  let hybridModel: PromptRouteModel | undefined

  if (messageComplexity === "low" && !input.requestedModel && !agent.model) {
    const defaultM = await Provider.defaultModel().catch(() => undefined)
    if (defaultM) {
      const small = await Provider.getSmallModel(defaultM.providerID)
      if (small) {
        complexityModel = { providerID: small.providerID, modelID: small.id }
        log.info("complexity-route", {
          command: "session.prompt.complexity",
          status: "ok",
          sessionID: input.sessionID,
          model: small.id,
        })
        Recorder.emit({
          type: "agent.route",
          sessionID: input.sessionID,
          messageID: input.messageID,
          fromAgent: agentName,
          toAgent: agentName,
          confidence: 0,
          routeMode: "complexity",
          complexity: messageComplexity,
        })
      }
    }
  }

  // Hybrid placement (ADR-049): only when modes.default is explicitly "hybrid"
  // and the user/agent did not pin a model. Does not override complexity small-model.
  const modes = (cfg as { modes?: ModePolicy.ModesConfig }).modes
  if (modes?.default === "hybrid" && !input.requestedModel && !agent.model && !complexityModel) {
    try {
      await Provider.ready()
      const providers = await Provider.list()
      const localProviderID = ProviderID.make(modes.hybrid?.localProviderID ?? AX_ENGINE_PROVIDER_ID)
      const localProvider = providers[localProviderID]
      const localModels = localProvider
        ? Provider.sort(
            Object.values(localProvider.models).filter((m) => modelSelectableForProvider(localProviderID, m)),
          )
        : []
      const localAvailable = localModels.length > 0
      const place = Hybrid.recommendPlacement({
        localAvailable,
        complexity: messageComplexity,
        preferLocalWhenAvailable: modes.hybrid?.preferLocalWhenAvailable,
        escalateOnHighComplexity: modes.hybrid?.escalateOnHighComplexity,
      })
      if (place.placement === "local" && localModels[0]) {
        hybridModel = { providerID: localProviderID, modelID: localModels[0].id }
        log.info("hybrid-route", {
          command: "session.prompt.hybrid",
          status: "ok",
          sessionID: input.sessionID,
          placement: place.placement,
          model: localModels[0].id,
          reasons: place.reasons,
        })
        Recorder.emit({
          type: "agent.route",
          sessionID: input.sessionID,
          messageID: input.messageID,
          fromAgent: agentName,
          toAgent: agentName,
          confidence: 0,
          routeMode: "hybrid",
          complexity: messageComplexity ?? undefined,
        })
      }
    } catch (error) {
      log.warn("hybrid-route failed", { error })
    }
  }

  return { agentName, agent, complexityModel, hybridModel }
}
