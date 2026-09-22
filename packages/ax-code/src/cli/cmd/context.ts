import { cmd } from "./cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { bootstrapReadonly } from "../bootstrap"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { Provider } from "../../provider/provider"
import { ProviderID, ModelID } from "../../provider/schema"
import { calculateBreakdown, formatBreakdown } from "../../stats"
import { EOL } from "os"

export type ContextJSONDocument = {
  session: string
  title: string
  provider: string | null
  model: string | null
  messages: number
  toolCalls: number
  tokens: {
    input: number
    output: number
    reasoning: number
    cached: number
  }
}

export function buildContextDocument(input: {
  session: Session.Info
  messages: number
  toolCalls: number
  provider: string | null
  model: string | null
  tokens: { input: number; output: number; reasoning: number; cached: number }
}): ContextJSONDocument {
  return {
    session: input.session.id,
    title: input.session.title || "untitled",
    provider: input.provider,
    model: input.model,
    messages: input.messages,
    toolCalls: input.toolCalls,
    tokens: { ...input.tokens },
  }
}

function writeContextJsonError(code: string, message: string) {
  process.stderr.write(JSON.stringify({ error: { code, message } }, null, 2) + EOL)
  process.exitCode = 1
}

export const ContextCommand = cmd({
  command: "context [sessionID]",
  describe: "show context window usage and token breakdown",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "session ID (default: latest session)",
        type: "string",
      })
      .option("json", {
        describe: "output machine-readable JSON",
        type: "boolean",
        default: false,
      }),
  async handler(args) {
    if (!args.json) {
      UI.empty()
      prompts.intro("Context Stats")
    }

    await bootstrapReadonly(process.cwd(), async () => {
      const sessions = [...Session.list({ limit: 1000 })]

      if (sessions.length === 0) {
        if (args.json) {
          writeContextJsonError("no-sessions", "No sessions found. Start a conversation first.")
          return
        }
        prompts.log.warn("No sessions found. Start a conversation first.")
        prompts.outro("Done")
        return
      }

      // Find target session
      let session: Session.Info | undefined
      let messages: Awaited<ReturnType<typeof Session.messages>>

      if (args.sessionID) {
        session = sessions.find((s) => s.id === args.sessionID)
        if (!session) {
          if (args.json) {
            writeContextJsonError("session-not-found", `Session "${args.sessionID}" not found`)
            return
          }
          prompts.log.error(`Session "${args.sessionID}" not found`)
          prompts.outro("Done")
          return
        }
        messages = await Session.messages({ sessionID: session.id })
      } else {
        // Skip sessions that never produced a usable assistant response (e.g.
        // failed or aborted runs) so the breakdown reflects a real model
        // context instead of "unknown" (#402).
        messages = []
        for (const candidate of sessions) {
          const candidateMessages = await Session.messages({ sessionID: candidate.id })
          const usable = candidateMessages.some((msg) => {
            if (msg.info.role !== "assistant") return false
            const info = msg.info as MessageV2.Assistant
            return Boolean(info.providerID && info.modelID)
          })
          if (usable) {
            session = candidate
            messages = candidateMessages
            break
          }
        }
        if (!session) {
          if (args.json) {
            writeContextJsonError(
              "no-context-session",
              "No session with model context found. Run a conversation first.",
            )
            return
          }
          prompts.log.warn("No session with model context found. Run a conversation first.")
          prompts.outro("Done")
          return
        }
      }

      if (!args.json) {
        prompts.log.info(`Session: ${session.id}`)
        prompts.log.info(`Title: ${session.title || "untitled"}`)
      }

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

      if (args.json) {
        const document = buildContextDocument({
          session,
          messages: messageCount,
          toolCalls,
          provider: providerID || null,
          model: modelID || null,
          tokens: { input: inputTokens, output: outputTokens, reasoning: reasoningTokens, cached: cachedTokens },
        })
        process.stdout.write(JSON.stringify(document, null, 2) + EOL)
        return
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

      if (sessions.length > 1 && !args.sessionID) {
        console.log(
          `\n${dim}${sessions.length} total sessions. Showing most recent with model context. Use: ax-code context <sessionID>${reset}`,
        )
      }

      prompts.outro("Done")
    })
  },
})
