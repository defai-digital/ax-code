import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { bootstrap } from "../bootstrap"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { Provider } from "../../provider/provider"
import { ProviderID, ModelID } from "../../provider/schema"
import { calculateBreakdown, formatBreakdown } from "../../stats"

export const ContextCommand = cmd({
  command: "context [sessionID]",
  describe: "show context window usage and token breakdown",
  builder: (yargs) =>
    yargs.positional("sessionID", {
      describe: "session ID (default: latest session)",
      type: "string",
    }),
  async handler(args) {
    UI.empty()
    prompts.intro("Context Stats")

    await bootstrap(process.cwd(), async () => {
      const sessions = [...Session.list({ limit: 1000 })].sort((a, b) => b.time.updated - a.time.updated)

      if (sessions.length === 0) {
        prompts.log.warn("No sessions found. Start a conversation first.")
        prompts.outro("Done")
        return
      }

      // Find target session
      const targetID = args.sessionID ?? sessions[0]?.id
      const session = sessions.find((s) => s.id === targetID)

      if (!session) {
        prompts.log.error(`Session "${targetID}" not found`)
        prompts.outro("Done")
        return
      }

      prompts.log.info(`Session: ${session.id}`)
      prompts.log.info(`Title: ${session.title || "untitled"}`)

      // Get messages for this session
      const messages = await Session.messages({ sessionID: session.id })

      let inputTokens = 0
      let outputTokens = 0
      let reasoningTokens = 0
      let cachedTokens = 0
      let toolCalls = 0
      let providerID = ""
      let modelID = ""
      let messageCount = 0

      for (const msg of messages) {
        messageCount++
        if (msg.info.role === "assistant") {
          const info = msg.info as MessageV2.Assistant
          const tokens = info.tokens
          if (tokens) {
            inputTokens += tokens.input ?? 0
            outputTokens += tokens.output ?? 0
            reasoningTokens += tokens.reasoning ?? 0
            cachedTokens += tokens.cache?.read ?? 0
          }
          providerID = info.providerID ?? providerID
          modelID = info.modelID ?? modelID

          for (const part of msg.parts) {
            if (part.type === "tool") toolCalls++
          }
        }
      }

      // Resolve the provider model so the breakdown reflects the real
      // context window from the snapshot rather than a stale local table.
      // When provider/model can't be resolved (e.g. session was created
      // against a model that has since been removed), fall back to the
      // unknown-limit branch in formatBreakdown.
      let model: Provider.Model | undefined
      if (providerID && modelID) {
        try {
          model = await Provider.getModel(ProviderID.make(providerID), ModelID.make(modelID))
        } catch {
          model = undefined
        }
      }

      const breakdown = calculateBreakdown({
        model,
        systemPromptLength: 0,
        toolCount: toolCalls,
        memoryTokens: 0,
        historyTokens: inputTokens,
      })

      // Print breakdown
      process.stdout.write(formatBreakdown(breakdown))

      const bold = "\x1b[1m"
      const dim = "\x1b[2m"
      const reset = "\x1b[0m"

      console.log(`${bold}Session Info:${reset}`)
      console.log(`  Provider:   ${providerID || "unknown"}`)
      console.log(`  Model:      ${modelID || "unknown"}`)
      console.log(`  Messages:   ${messageCount}`)
      console.log(`  Tool calls: ${toolCalls}`)
      console.log()

      console.log(`${bold}Token Usage:${reset}`)
      console.log(`  Input:      ${inputTokens.toLocaleString()}`)
      console.log(`  Output:     ${outputTokens.toLocaleString()}`)
      console.log(`  Reasoning:  ${reasoningTokens.toLocaleString()}`)
      console.log(`  Cached:     ${cachedTokens.toLocaleString()}`)
      console.log()

      if (sessions.length > 1) {
        console.log(
          `\n${dim}${sessions.length} total sessions. Showing latest. Use: ax-code context <sessionID>${reset}`,
        )
      }

      prompts.outro("Done")
    })
  },
})
