import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Session } from "."
import { SessionID, MessageID, PartID } from "./schema"
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
import { CompactionFallback } from "./compaction-fallback"
import { isLocalProvider } from "./prompt-provider-fallback"
import { sessionAssistantPath, zeroTokenUsage } from "./prompt-message-builders"
import { estimateRequestTokens } from "./prompt-request"
import { SystemPrompt } from "./system"
import type { ModelMessage } from "ai"
import {
  MIN_USABLE_TOKENS,
  SUPER_LONG_USABLE_FRACTION,
  calculateCompactionBudget,
  effectiveTokenTotal,
} from "./compaction-budget"
import { MediaProjection } from "./media-projection"
import { agentModel } from "./prompt-command-selection"

export namespace SessionCompaction {
  const log = Log.create({ service: "session.compaction" })
  const inFlight = new Set<string>()

  export const TriggerReason = MessageV2.CompactionTriggerReason
  export type TriggerReason = MessageV2.CompactionTriggerReason

  export const Event = {
    Compacted: BusEvent.define(
      "session.compacted",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
  }

  // Budget math lives in ./compaction-budget (shared with the TUI footer
  // gauge). Users can override the reserved headroom with an explicit
  // `compaction.reserved` token count in ax-code.json.

  /** The input budget for an actual compaction request, even when automatic compaction is disabled. */
  export async function requestBudget(model: Provider.Model) {
    const config = await Config.get()
    return calculateCompactionBudget(model, config.compaction?.reserved)
  }

  /** The budget used to decide whether automatic compaction should run. */
  export async function budget(model: Provider.Model) {
    const config = await Config.get()
    if (config.compaction?.auto === false) return undefined
    const result = calculateCompactionBudget(model, config.compaction?.reserved)
    if (!result) return undefined
    // Clamp tiny usable budgets off: if reserved nearly consumes the cap,
    // any realistic compacted message still overflows and compaction fires
    // on every step.
    if (result.usable < MIN_USABLE_TOKENS) return undefined
    return result
  }

  // Extra headroom for provider framing and estimation error. The actual
  // compaction system/user prompts are measured separately below.
  const COMPACTION_REQUEST_HEADROOM_TOKENS = 2_000

  /**
   * Trim the oldest messages so a compaction request fits the model window.
   * Walks from newest to oldest and keeps the longest suffix whose estimated
   * tokens fit the budget. An optional boundary predicate prevents returning
   * a suffix that starts in the middle of a conversation turn.
   */
  export function trimMessagesForCompaction<T>(input: {
    messages: T[]
    estimate: (message: T) => number
    budgetTokens: number
    canStartWith?: (message: T) => boolean
  }): { messages: T[]; omitted: number } {
    let total = 0
    let keepFrom = input.messages.length
    for (let i = input.messages.length - 1; i >= 0; i--) {
      const message = input.messages[i]!
      const estimate = input.estimate(message)
      const next = total + (Number.isFinite(estimate) ? Math.max(0, estimate) : Number.POSITIVE_INFINITY)
      if (next > input.budgetTokens) break
      total = next
      if (!input.canStartWith || input.canStartWith(message)) keepFrom = i
    }
    return { messages: input.messages.slice(keepFrom), omitted: keepFrom }
  }

  function omittedHistoryNotice(omitted: number) {
    return (
      `\n\nNote: the ${omitted} oldest message(s) were omitted from this summary input because the ` +
      `full history exceeds the model's context window. Summarize only what is visible above, explicitly ` +
      `state that earlier history was omitted, and do not invent details from it.`
    )
  }

  function compactionPromptMessage(text: string): ModelMessage {
    return {
      role: "user",
      content: [{ type: "text", text }],
    }
  }

  // Super-Long runs compact earlier (~75% of the usable budget instead of
  // 100%); see SUPER_LONG_USABLE_FRACTION in ./compaction-budget.
  export async function isOverflow(input: {
    tokens: MessageV2.Assistant["tokens"]
    model: Provider.Model
    superLong?: boolean
  }) {
    const tokenBudget = await budget(input.model)
    if (!tokenBudget) return false
    const limit = input.superLong ? tokenBudget.usable * SUPER_LONG_USABLE_FRACTION : tokenBudget.usable
    return effectiveTokenTotal(input.tokens) >= limit
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
    triggerReason?: TriggerReason
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
      // User lifecycle hooks (PreCompact) — observational only; hook
      // failures never block compaction.
      try {
        const { LifecycleHooks } = await import("@/hooks/lifecycle")
        await LifecycleHooks.runForWorkspace({
          event: "PreCompact",
          sessionID: input.sessionID,
          args: { auto: input.auto, overflow: input.overflow === true },
        })
      } catch (error) {
        log.warn("PreCompact lifecycle hooks failed", { sessionID: input.sessionID, error })
      }
      const result = await processInner(input)
      // User lifecycle hooks (PostCompact) — observational only, fired after
      // compaction completes. A "stop" result means compaction BAILED (e.g.
      // the context-overflow paths in processInner) — nothing was compacted,
      // so the hook must not fire. Fire-and-forget: hook latency/failures
      // must never affect the compaction result. Reason only, never summary
      // text.
      if (result !== "stop") {
        try {
          const { LifecycleHooks } = await import("@/hooks/lifecycle")
          void LifecycleHooks.runForWorkspace({
            event: "PostCompact",
            sessionID: input.sessionID,
            args: { sessionID: input.sessionID, reason: input.auto ? "auto" : "manual" },
          }).catch((error) => log.warn("PostCompact lifecycle hooks failed", { sessionID: input.sessionID, error }))
        } catch (error) {
          log.warn("PostCompact lifecycle hooks failed", { sessionID: input.sessionID, error })
        }
      }
      return result
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
          const parts = projectReplayParts(msg.parts, input.triggerReason)
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
    const userModel = await Provider.resolveRequestedModel(userMessage.model)
    // Compaction is an aux call: explicit agent pin first, then the
    // provider's small tier, and only bill the session's main model as the
    // fallback (providers without a small-model mapping).
    const pinned = await agentModel(agent)
    let model = pinned
      ? await Provider.getModel(pinned.providerID, pinned.modelID)
      : ((await Provider.getSmallModel(userModel.providerID)) ??
        (await Provider.getModel(userModel.providerID, userModel.modelID)))
    // C9: resolve the next ladder rung lazily — only on a transient failure —
    // so the happy path performs no extra provider lookups. Order mirrors the
    // primary selection: the provider's small tier first (when an agent pin
    // skipped it), then the session's main model.
    const resolveNextRung = async (current: Provider.Model): Promise<Provider.Model | undefined> => {
      const candidates: Array<Provider.Model | undefined> = []
      if (agent.model) {
        candidates.push(await Provider.getSmallModel(userModel.providerID).catch(() => undefined))
      }
      candidates.push(await Provider.getModel(userModel.providerID, userModel.modelID).catch(() => undefined))
      return candidates.find(
        (candidate) => candidate && (candidate.providerID !== current.providerID || candidate.id !== current.id),
      )
    }
    // C9: a transient provider error retries once against the next ladder
    // rung (max CompactionFallback.MAX_ATTEMPTS total attempts). Non-transient
    // classes (invalid request, context-window-exceeded) never retry.
    for (let attempt = 1; attempt <= CompactionFallback.MAX_ATTEMPTS; attempt++) {
      const msg = (await Session.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: input.parentID,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        variant: userMessage.variant,
        summary: true,
        path: sessionAssistantPath(),
        tokens: zeroTokenUsage(),
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
      const stopForContextOverflow = async (message: string) => {
        processor.message.error = new MessageV2.ContextOverflowError({ message }).toObject()
        processor.message.finish = "error"
        // The pre-flight rejection below returns before processor.process runs,
        // which is the only other place time.completed gets set. Without it the
        // message looks in-flight forever and the TUI queues every later turn.
        processor.message.time.completed = Date.now()
        await Session.updateMessage(processor.message)
        return "stop" as const
      }
      const stopForRequestTooLarge = async (message: string) => {
        processor.message.error = new MessageV2.RequestTooLargeError({ message }).toObject()
        processor.message.finish = "error"
        processor.message.time.completed = Date.now()
        await Session.updateMessage(processor.message)
        return "stop" as const
      }
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

[What goal(s) is the user trying to accomplish? Include explicit constraints and preferences, quoted verbatim where the wording matters.]

## Decisions

[What technical decisions were made, and why? Include rejected alternatives when the rejection matters.]

## Progress

[What work has been completed, what is still in progress? State verification status explicitly: which tests, typecheck, or builds ran, and whether they passed, failed, or have not been run yet.]

## Errors

[What errors were hit, and how was each resolved — or is it still unresolved?]

## Next steps

[What remains to be done, in order? Name the immediate next action first.]

## Files

[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand, each with a one-line note. If all the files in a directory are relevant, include the path to the directory.]
---`

      const promptText = compacting.prompt ?? [defaultPrompt, ...compacting.context].join("\n\n")
      const msgs = [...messages]
      await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
      // If the history to summarize exceeds the compaction model's own window,
      // the summarization request itself overflows and compaction hard-fails,
      // which bricks the session for small-context models (observed: a
      // ~100k-token session switched to a 32k local model could never compact
      // and every prompt failed with ContextOverflowError). Drop the oldest
      // messages until the request fits — losing old detail beats never
      // compacting. The prompt notes the omission so the summary stays honest.
      const historyGroups: Array<{ modelMessages: ModelMessage[] }> = []
      for (const message of msgs) {
        historyGroups.push({
          modelMessages: await MessageV2.toModelMessages([message], model, { stripMedia: true }),
        })
      }
      let selectedGroups = historyGroups
      let finalPromptText = promptText
      const tokenBudget = await requestBudget(model)
      if (tokenBudget) {
        const system = SystemPrompt.request({ agent, model, system: [], userSystem: userMessage.system })
        const historyModelMessages = historyGroups.flatMap((group) => group.modelMessages)
        const untrimmedTokens =
          estimateRequestTokens({
            system,
            messages: [...historyModelMessages, compactionPromptMessage(promptText)],
          }) + COMPACTION_REQUEST_HEADROOM_TOKENS

        if (untrimmedTokens > tokenBudget.usable) {
          // Budget the longest possible omission notice up front. The actual
          // omitted count can only use the same or fewer digits, so the final
          // request remains within the estimate after selection.
          const promptWithNotice = promptText + omittedHistoryNotice(historyGroups.length)
          const fixedTokens =
            estimateRequestTokens({ system, messages: [compactionPromptMessage(promptWithNotice)] }) +
            COMPACTION_REQUEST_HEADROOM_TOKENS
          const trimmed = trimMessagesForCompaction({
            messages: historyGroups,
            estimate: (group) => estimateRequestTokens({ system: [], messages: group.modelMessages }),
            budgetTokens: tokenBudget.usable - fixedTokens,
            // Starting with an assistant/tool-result fragment can be rejected by
            // strict providers and separates tool results from their user turn.
            canStartWith: (group) => group.modelMessages[0]?.role === "user",
          })
          selectedGroups = trimmed.messages
          if (trimmed.omitted > 0) {
            log.info("trimmed oldest messages so compaction fits the model window", {
              sessionID: input.sessionID,
              omitted: trimmed.omitted,
              kept: trimmed.messages.length,
              budgetUsable: tokenBudget.usable,
            })
            finalPromptText = promptText + omittedHistoryNotice(trimmed.omitted)
          }
        }

        const finalModelMessages = selectedGroups.flatMap((group) => group.modelMessages)
        const finalTokens =
          estimateRequestTokens({
            system,
            messages: [...finalModelMessages, compactionPromptMessage(finalPromptText)],
          }) + COMPACTION_REQUEST_HEADROOM_TOKENS
        if (finalTokens > tokenBudget.usable) {
          log.warn("compaction instructions exceed model window after omitting history", {
            sessionID: input.sessionID,
            estimatedTokens: finalTokens,
            budgetUsable: tokenBudget.usable,
          })
          return stopForContextOverflow(
            "Compaction instructions exceed this model's context window even with conversation history omitted. " +
              "Reduce custom compaction or system instructions, or switch to a model with a larger context window.",
          )
        }
      }
      const historyModelMessages = selectedGroups.flatMap((group) => group.modelMessages)
      const result = await processor.process({
        user: userMessage,
        agent,
        abort: input.abort,
        sessionID: input.sessionID,
        tools: {},
        system: [],
        messages: [...historyModelMessages, compactionPromptMessage(finalPromptText)],
        model,
      })

      if (result === "compact") {
        // Context-window-exceeded is never retried down the ladder (C9).
        return stopForContextOverflow(
          replay
            ? "Session too large to compact - context exceeds model limit even after trimming and stripping media. " +
                "Start a new session, or switch to a model with a larger context window."
            : "Conversation history is too large for this model's context window even after trimming. " +
                "Start a new session, or switch to a model with a larger context window.",
        )
      }
      if (result === "compact_request_too_large") {
        return stopForRequestTooLarge(
          "The provider rejected the compaction request body as too large even after trimming history and stripping media. " +
            "Reduce custom instructions or the provider tool surface, or switch providers.",
        )
      }
      if (result === "stop") {
        const error = processor.message.error
        // Aborts and blocked turns carry no provider error — nothing to classify.
        if (!error) return "stop"
        const failure = CompactionFallback.classify(error)
        CompactionFallback.annotate(error, { retryAttempt: attempt, failureClass: failure.class })
        await Session.updateMessage(processor.message)
        if (failure.retryable && attempt < CompactionFallback.MAX_ATTEMPTS) {
          const next = await resolveNextRung(model)
          if (next) {
            // Privacy guard (same rule as the prompt loop's provider
            // fallback): a session on a local provider must never silently
            // migrate to a remote one — that would leak prompts and code off
            // this machine.
            const refused = next.providerID !== model.providerID && (await isLocalProvider(model.providerID))
            if (refused) {
              log.warn("compaction fallback refused: would migrate off a local provider", {
                sessionID: input.sessionID,
                providerID: model.providerID,
                candidateProviderID: next.providerID,
                failureClass: failure.class,
              })
            } else {
              log.warn("compaction failed with a transient error, retrying with the next fallback model", {
                sessionID: input.sessionID,
                attempt,
                failureClass: failure.class,
                from: `${model.providerID}/${model.id}`,
                to: `${next.providerID}/${next.id}`,
              })
              model = next
              continue
            }
          }
        }
        return "stop"
      }

      if (input.auto) {
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
              const part = {
                ...item,
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
          const overflowNotice =
            input.triggerReason === "request_too_large"
              ? "The previous request exceeded the provider's request-body size limit. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
              : input.overflow
                ? "The previous request exceeded the model's context window. The conversation was compacted and media files were removed from context. Continue from the compacted summary without claiming that media size caused the failure.\n\n"
                : ""
          const text =
            overflowNotice +
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
    // Unreachable: every loop path returns, and the retry `continue` only runs
    // below MAX_ATTEMPTS. Keeps the function's return type total for TS.
    return "stop"
  }

  /** Remove request-body media while preserving enough context to replay an overflowed user turn safely. */
  export function projectReplayParts(parts: MessageV2.Part[], triggerReason?: TriggerReason): MessageV2.Part[] {
    return parts.flatMap((part): MessageV2.Part[] => {
      if (part.type !== "file") return [part]
      if (!MessageV2.isMedia(part.mime)) return []
      return [
        {
          id: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
          type: "text",
          synthetic: true,
          text:
            triggerReason === "request_too_large"
              ? `${MediaProjection.OMITTED_TEXT} (${part.filename ?? part.mime})`
              : `[media omitted from compacted replay] (${part.filename ?? part.mime})`,
        },
      ]
    })
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
      const triggerReason = input.triggerReason ?? (input.auto ? "provider_usage" : "manual")
      log.info("compaction scheduled", {
        command: "session.compaction.create",
        status: "ok",
        sessionID: input.sessionID,
        triggerReason,
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
        triggerReason,
      })
    },
  )
}
