import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { SessionID, MessageID, PartID } from "./schema"
import { Instance } from "../project/instance"
import { Provider } from "../provider/provider"
import { MessageV2 } from "./message-v2"
import z from "zod"
import { Token } from "../util/token"
import { Log } from "../util/log"
import { SessionProcessor } from "./processor"
import { fn } from "@/util/fn"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { PRUNE_MINIMUM, PRUNE_PROTECT } from "@/constants/session"
import { Database } from "@/storage/db"
import { MessageTable, PartTable } from "./session.sql"
import { ModelID, ProviderID } from "@/provider/schema"
import { ContextTier } from "./context-tier"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })
  const inFlight = new Set<string>()

  export const TriggerReason = z.enum(["provider_usage", "context_overflow_error", "prompt_preflight", "manual"])
  export type TriggerReason = z.infer<typeof TriggerReason>

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  // Default headroom reserved for the next response: 10% of the input
  // budget. Keeps compaction firing at ~90% of capacity across every model
  // — small (8k) or large (1M / 2M) — without coupling to model.output,
  // which is unreliable: some snapshot entries report output == context,
  // which would zero out usable under any `context - output` formula.
  // Users can override with an explicit `compaction.reserved` token count
  // in ax-code.json.
  const DEFAULT_RESERVED_FRACTION = 0.1
  const MIN_USABLE_TOKENS = 1_000

  function componentTotal(tokens: MessageV2.Assistant["tokens"]) {
    return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  }

  function effectiveTotal(tokens: MessageV2.Assistant["tokens"]) {
    const total = typeof tokens.total === "number" && Number.isFinite(tokens.total) ? tokens.total : 0
    return Math.max(total, componentTotal(tokens))
  }

  export async function budget(model: Provider.Model) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return undefined
    const context = model.limit.context
    if (context === 0) return undefined

    // For prompt-cached providers (Claude) limit.input is the input cap and
    // is smaller than limit.context; otherwise context is the cap. Use `||`
    // so a stray `limit.input: 0` falls through to context — `??` would
    // treat 0 as a valid cap and never compact.
    const cap = model.limit.input || context
    const reserved = config.compaction?.reserved ?? Math.ceil(cap * DEFAULT_RESERVED_FRACTION)
    // Clamp tiny usable budgets off: if reserved nearly consumes the cap,
    // any realistic compacted message still overflows and compaction fires
    // on every step.
    const usable = Math.max(0, cap - reserved)
    if (usable < MIN_USABLE_TOKENS) return undefined
    return { cap, reserved, usable }
  }

  // Super-Long runs compact earlier (~75% of the usable budget instead of
  // 100%): nobody is watching to /compact manually, per-turn latency grows
  // with history — which is the dominant cost on local inference — and a
  // multi-day run otherwise spends its tail end permanently near the cap.
  const SUPER_LONG_USABLE_FRACTION = 0.75

  export async function isOverflow(input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
    superLong?: boolean
  }) {
    const tokenBudget = await budget(input.model)
    if (!tokenBudget) return false
    const limit = input.superLong ? tokenBudget.usable * SUPER_LONG_USABLE_FRACTION : tokenBudget.usable
    return effectiveTotal(input.tokens) >= limit
  }

  const PRUNE_PROTECTED_TOOLS = ["skill"]
  const TOOL_RESULT_WRAPPER_TOKENS = 16

  function stringifyForEstimate(value: unknown) {
    try {
      return JSON.stringify(value) ?? ""
    } catch {
      return safeStringForEstimate(value)
    }
  }

  function safeStringForEstimate(value: unknown) {
    try {
      return String(value)
    } catch {
      return "[unprintable]"
    }
  }

  function attachmentPlaceholder(attachment: MessageV2.FilePart) {
    const filename = attachment.filename ?? "file"
    return `[Attachment ${attachment.mime}: ${filename}]`
  }

  function estimateToolPartTokens(part: MessageV2.ToolPart) {
    if (part.state.status !== "completed") return 0

    const attachmentSummary = (part.state.attachments ?? []).map(attachmentPlaceholder).join("\n")
    return (
      TOOL_RESULT_WRAPPER_TOKENS +
      Token.estimate(part.tool) +
      Token.estimate(part.state.title) +
      Token.estimate(stringifyForEstimate(part.state.input)) +
      Token.estimate(part.state.output) +
      Token.estimate(stringifyForEstimate(part.state.metadata)) +
      Token.estimate(attachmentSummary)
    )
  }

  // goes backwards through parts until there are 40_000 tokens worth of tool
  // calls. then erases output of previous tool calls. idea is to throw away old
  // tool calls that are no longer relevant.
  //
  // Tier-aware pruning: when context tiers are available, Tier 3 (background)
  // content is pruned first, then Tier 2 (supporting), then Tier 1 (critical).
  // This keeps the most relevant context even when the session is large.
  export async function prune(input: { sessionID: SessionID; messages?: MessageV2.WithParts[] }) {
    const config = await Config.get()
    if (config.compaction?.prune === false) return
    log.info("pruning")
    const msgs = input.messages ?? (await Session.messages({ sessionID: input.sessionID }))

    // Classify messages into tiers for priority-based pruning
    const classified = ContextTier.classify(msgs)
    const tierMap = new Map<string, ContextTier.Tier>()
    for (const c of classified) {
      tierMap.set(c.message.info.id, c.tier)
    }
    const dist = ContextTier.distribution(classified)
    log.info("tier distribution", dist)

    let total = 0
    let pruned = 0
    let turns = 0

    // Collect candidates grouped by tier, then prune from lowest tier first
    const tier3Candidates: { part: MessageV2.ToolPart; estimate: number }[] = []
    const tier2Candidates: { part: MessageV2.ToolPart; estimate: number }[] = []
    const tier1Candidates: { part: MessageV2.ToolPart; estimate: number }[] = []

    loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
      const msg = msgs[msgIndex]
      if (msg.info.role === "user") turns++
      if (turns < 2) continue
      if (msg.info.role === "assistant" && msg.info.summary) break loop
      const tier = tierMap.get(msg.info.id) ?? 3
      for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
        const part = msg.parts[partIndex]
        if (part.type === "tool")
          if (part.state.status === "completed") {
            if (PRUNE_PROTECTED_TOOLS.includes(part.tool)) continue

            if (part.state.time.compacted) continue
            const estimate = estimateToolPartTokens(part)
            total += estimate
            if (total > PRUNE_PROTECT) {
              pruned += estimate
              const candidate = { part, estimate }
              if (tier === 3) tier3Candidates.push(candidate)
              else if (tier === 2) tier2Candidates.push(candidate)
              else tier1Candidates.push(candidate)
            }
          }
      }
    }
    log.info("found", {
      pruned,
      total,
      tier3: tier3Candidates.length,
      tier2: tier2Candidates.length,
      tier1: tier1Candidates.length,
    })

    if (pruned > PRUNE_MINIMUM) {
      const timestamp = Date.now()
      let selectedTokens = 0
      const selectedCandidates: { part: MessageV2.ToolPart; estimate: number; tier: ContextTier.Tier }[] = []
      const tiers: { tier: ContextTier.Tier; candidates: { part: MessageV2.ToolPart; estimate: number }[] }[] = [
        { tier: 3, candidates: tier3Candidates },
        { tier: 2, candidates: tier2Candidates },
        { tier: 1, candidates: tier1Candidates },
      ]

      for (const { tier, candidates } of tiers) {
        if (candidates.length === 0) continue
        // Candidates are collected while walking messages newest-to-oldest.
        // Within the same priority tier, compact the oldest tool results first.
        for (const candidate of [...candidates].reverse()) {
          selectedTokens += candidate.estimate
          selectedCandidates.push({ ...candidate, tier })
          if (selectedTokens > PRUNE_MINIMUM) break
        }
        if (selectedTokens > PRUNE_MINIMUM) break
      }

      const compactedParts = selectedCandidates.flatMap(({ part, tier }) => {
        if (part.state.status !== "completed") return []
        return [
          {
            tier,
            part: {
              ...part,
              state: {
                ...part.state,
                time: {
                  ...(part.state.time ?? { start: timestamp, end: timestamp }),
                  compacted: timestamp,
                },
              },
            },
          },
        ]
      })
      // Write all pruned parts in a single transaction; per-part writes
      // meant one DB round-trip per part, which dominated prune time on
      // large sessions. If the batch fails (e.g. one corrupt part aborts
      // the transaction), fall back to per-part writes with per-iteration
      // try/catch so a single failing part doesn't abort the rest.
      let succeeded = 0
      let failed = 0
      try {
        await Session.updateParts(compactedParts.map(({ part }) => part))
        succeeded = compactedParts.length
      } catch (batchError) {
        log.warn("batch prune write failed, retrying per part", { err: batchError })
        for (const { part, tier } of compactedParts) {
          try {
            await Session.updatePart.force(part)
            succeeded += 1
          } catch (e) {
            failed += 1
            log.warn("failed to compact part", { partID: part.id, tier, err: e })
          }
        }
      }
      log.info("pruned", { count: compactedParts.length, selectedTokens, succeeded, failed })
    }
  }

  export async function process(input: {
    parentID: MessageID
    messages: MessageV2.WithParts[]
    sessionID: SessionID
    abort: AbortSignal
    auto: boolean
    overflow?: boolean
  }) {
    if (inFlight.has(input.sessionID)) {
      log.info("compaction already in-flight", {
        command: "session.compaction.process",
        status: "busy",
        sessionID: input.sessionID,
      })
      return "busy" as const
    }
    inFlight.add(input.sessionID)
    try {
      return await processInner(input)
    } finally {
      inFlight.delete(input.sessionID)
    }
  }

  async function processInner(input: Parameters<typeof process>[0]) {
    const parent = input.messages.findLast((m) => m.info.id === input.parentID)
    if (!parent) throw new Error(`Compaction failed: parent message ${input.parentID} not found`)
    const userMessage = parent.info as MessageV2.User

    let messages = input.messages
    let replay: MessageV2.WithParts | undefined
    if (input.overflow) {
      const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
      for (let i = idx - 1; i >= 0; i--) {
        const msg = input.messages[i]
        if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
          const parts = msg.parts.filter((part) => part.type !== "file")
          if (parts.length === 0) continue
          replay = {
            ...msg,
            parts,
          }
          messages = [...input.messages.slice(0, i), replay]
          break
        }
      }
    }

    const agent = await Agent.get("compaction")
    if (!agent) throw new Error("Compaction agent is not configured or has been disabled")
    const model = agent?.model
      ? await Provider.getModel(agent.model.providerID, agent.model.modelID)
      : await Provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
    const msg = (await Session.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      parentID: input.parentID,
      sessionID: input.sessionID,
      mode: "compaction",
      agent: "compaction",
      variant: userMessage.variant,
      summary: true,
      path: {
        cwd: Instance.directory,
        root: Instance.worktree,
      },
      tokens: {
        output: 0,
        input: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      modelID: model.id,
      providerID: model.providerID,
      time: {
        created: Date.now(),
      },
    })) as MessageV2.Assistant
    const processor = SessionProcessor.create({
      assistantMessage: msg,
      sessionID: input.sessionID,
      model,
      abort: input.abort,
    })
    // Allow plugins to inject context or replace compaction prompt
    const compacting = await Plugin.trigger(
      "experimental.session.compacting",
      { sessionID: input.sessionID },
      { context: [], prompt: undefined },
    )
    const defaultPrompt = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal

[What goal(s) is the user trying to accomplish?]

## Instructions

- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries

[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished

[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`

    const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
    const msgs = [...messages]
    await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
    const result = await processor.process({
      user: userMessage,
      agent,
      abort: input.abort,
      sessionID: input.sessionID,
      tools: {},
      system: [],
      messages: [
        ...(await MessageV2.toModelMessages(msgs, model, { stripMedia: true })),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: promptText,
            },
          ],
        },
      ],
      model,
    })

    if (result === "compact") {
      processor.message.error = new MessageV2.ContextOverflowError({
        message: replay
          ? "Session too large to compact - context exceeds model limit even after stripping media"
          : "Conversation history too large to compact - exceeds model context limit",
      }).toObject()
      processor.message.finish = "error"
      await Session.updateMessage(processor.message)
      return "stop"
    }
    if (result === "stop") return "stop"

    if (result === "continue" && input.auto) {
      if (replay) {
        const original = replay.info as MessageV2.User
        const replayMsg: MessageV2.User = {
          id: MessageID.ascending(),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          agent: original.agent,
          model: original.model,
          format: original.format,
          tools: original.tools,
          system: original.system,
          variant: original.variant,
        }
        Database.transaction((db) => {
          const { id, sessionID, ...data } = replayMsg
          db.insert(MessageTable)
            .values({
              id,
              session_id: sessionID,
              time_created: replayMsg.time.created,
              data,
            })
            .run()
          Database.effect(() => Bus.publishDetached(MessageV2.Event.Updated, { info: replayMsg }))
          for (const item of replay.parts) {
            if (item.type === "compaction") continue
            const replayPart =
              item.type === "file" && MessageV2.isMedia(item.mime)
                ? { type: "text" as const, text: `[Attached ${item.mime}: ${item.filename ?? "file"}]` }
                : item
            const part = {
              ...replayPart,
              id: PartID.ascending(),
              messageID: replayMsg.id,
              sessionID: input.sessionID,
            }
            const { id, messageID, sessionID, ...data } = part
            db.insert(PartTable)
              .values({
                id,
                message_id: messageID,
                session_id: sessionID,
                time_created: Date.now(),
                data,
              })
              .run()
            Database.effect(() => Bus.publishDetached(MessageV2.Event.PartUpdated, { part: { ...part } }))
          }
        })
      } else {
        const continueMsg: MessageV2.User = {
          id: MessageID.ascending(),
          role: "user",
          sessionID: input.sessionID,
          time: { created: Date.now() },
          agent: userMessage.agent,
          model: userMessage.model,
        }
        const text =
          (input.overflow
            ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
            : "") +
          "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
        const part: MessageV2.TextPart = {
          id: PartID.ascending(),
          messageID: continueMsg.id,
          sessionID: input.sessionID,
          type: "text",
          synthetic: true,
          text,
          time: {
            start: Date.now(),
            end: Date.now(),
          },
        }
        Database.transaction((db) => {
          const { id, sessionID, ...data } = continueMsg
          db.insert(MessageTable)
            .values({
              id,
              session_id: sessionID,
              time_created: continueMsg.time.created,
              data,
            })
            .run()
          Database.effect(() => Bus.publishDetached(MessageV2.Event.Updated, { info: continueMsg }))
          const { id: partID, messageID, sessionID: partSessionID, ...partData } = part
          db.insert(PartTable)
            .values({
              id: partID,
              message_id: messageID,
              session_id: partSessionID,
              time_created: Date.now(),
              data: partData,
            })
            .run()
          Database.effect(() => Bus.publishDetached(MessageV2.Event.PartUpdated, { part: { ...part } }))
        })
      }
    }
    if (processor.message.error) return "stop"
    await Bus.publish(Event.Compacted, { sessionID: input.sessionID })
    return "continue"
  }

  export const create = fn(
    z.object({
      sessionID: SessionID.zod,
      agent: z.string(),
      model: z.object({
        providerID: ProviderID.zod,
        modelID: ModelID.zod,
      }),
      auto: z.boolean(),
      overflow: z.boolean().optional(),
      triggerReason: TriggerReason.optional(),
    }),
    async (input) => {
      log.info("compaction scheduled", {
        command: "session.compaction.create",
        status: "ok",
        sessionID: input.sessionID,
        triggerReason: input.triggerReason ?? (input.auto ? "provider_usage" : "manual"),
        auto: input.auto,
        overflow: input.overflow,
        agent: input.agent,
        providerID: input.model.providerID,
        modelID: input.model.modelID,
      })
      const msg = await Session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: {
          created: Date.now(),
        },
      })
      await Session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
    },
  )
}
