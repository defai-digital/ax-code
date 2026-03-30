import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { bootstrap } from "../bootstrap"
import { Database } from "../../storage/db"
import { SessionTable } from "../../session/session.sql"
import { Session } from "../../session"
import { calculateBreakdown, formatBreakdown, estimateCost } from "../../stats"

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
      // Get sessions from database directly (like stats command does)
      const sessions = Database.use((db) =>
        db.select().from(SessionTable).all(),
      ).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))

      if (sessions.length === 0) {
        prompts.log.warn("No sessions found. Start a conversation first.")
        prompts.outro("Done")
        return
      }

      // Find target session
      const targetID = args.sessionID ?? sessions[0]?.id
      const sessionRow = sessions.find((s) => s.id === targetID)

      if (!sessionRow) {
        prompts.log.error(`Session "${targetID}" not found`)
        prompts.outro("Done")
        return
      }

      prompts.log.info(`Session: ${sessionRow.id}`)
      prompts.log.info(`Title: ${sessionRow.title ?? "untitled"}`)

      // Get messages for this session
      const messages = await Session.messages({ sessionID: targetID })

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
          const tokens = (msg.info as any).tokens
          if (tokens) {
            inputTokens += tokens.input ?? 0
            outputTokens += tokens.output ?? 0
            reasoningTokens += tokens.reasoning ?? 0
            cachedTokens += tokens.cache?.read ?? 0
          }
          providerID = (msg.info as any).providerID ?? providerID
          modelID = (msg.info as any).modelID ?? modelID

          for (const part of msg.parts) {
            if (part.type === "tool") toolCalls++
          }
        }
      }

      // Build breakdown
      const breakdown = calculateBreakdown({
        modelID,
        systemPromptLength: 5000,
        toolCount: 15,
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

      const cost = estimateCost(providerID, inputTokens, outputTokens, cachedTokens)
      console.log(`${bold}Estimated Cost:${reset} $${cost.totalCost.toFixed(4)} ${dim}(input: $${cost.inputCost.toFixed(4)}, output: $${cost.outputCost.toFixed(4)})${reset}`)

      if (sessions.length > 1) {
        console.log(`\n${dim}${sessions.length} total sessions. Showing latest. Use: ax-code context <sessionID>${reset}`)
      }

      prompts.outro("Done")
    })
  },
})
