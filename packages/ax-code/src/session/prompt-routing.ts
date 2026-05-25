import { Agent } from "../agent/agent"
import { classifyComplexity, route as routeAgent } from "../agent/router"
import { Bus } from "../bus"
import { TuiEvent } from "../cli/cmd/tui/event"
import { Config } from "../config/config"
import { Provider } from "../provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { Recorder } from "../replay/recorder"
import { Log } from "../util/log"
import { MessageID, SessionID } from "./schema"
import { agentInfo } from "./prompt-helpers"

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
        Bus.publishDetached(TuiEvent.ToastShow, {
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

  return { agentName, agent, complexityModel }
}
