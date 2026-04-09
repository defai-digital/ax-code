import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import { DOOM_LOOP_THRESHOLD as _DOOM_LOOP_THRESHOLD } from "@/constants/session"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { Permission } from "@/permission"
import { Question } from "@/question"
import { SelfCorrection } from "./correction"
import { PartID } from "./schema"
import type { SessionID, MessageID } from "./schema"
import { NamedError } from "@ax-code/util/error"
import { Recorder } from "@/replay/recorder"
import { Database } from "@/storage/db"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = _DOOM_LOOP_THRESHOLD
  const log = Log.create({ service: "session.processor" })
  const DELTA_BATCH_MS = 16

  /** Batches delta events by time window to reduce event fan-out */
  function createDeltaBatcher(sessionID: SessionID, messageID: MessageID) {
    const pending = new Map<PartID, string[]>() // partID -> accumulated delta chunks
    let timer: ReturnType<typeof setTimeout> | undefined

    const flush = () => {
      timer = undefined
      for (const [partID, chunks] of pending) {
        Bus.publish(MessageV2.Event.PartDelta, { sessionID, messageID, partID, field: "text", delta: chunks.join("") })
      }
      pending.clear()
    }

    return {
      push(partID: PartID, delta: string) {
        const existing = pending.get(partID)
        if (existing) existing.push(delta)
        else pending.set(partID, [delta])
        if (!timer) timer = setTimeout(flush, DELTA_BATCH_MS)
      },
      flush() {
        if (timer) clearTimeout(timer)
        if (pending.size > 0) flush()
      },
    }
  }

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: SessionID
    model: Provider.Model
    abort: AbortSignal
    messages?: MessageV2.WithParts[]
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    const toolInputCache: Record<string, string> = {}
    const canonicalize = (obj: unknown): string => {
      if (typeof obj !== "object" || obj === null) return JSON.stringify(obj)
      if (Array.isArray(obj)) return "[" + obj.map(canonicalize).join(",") + "]"
      return "{" + Object.keys(obj as Record<string, unknown>).sort().map((k) => JSON.stringify(k) + ":" + canonicalize((obj as Record<string, unknown>)[k])).join(",") + "}"
    }
    const recentToolRing: { tool: string; input: string }[] = []
    const deltaBatcher = createDeltaBatcher(input.sessionID, input.assistantMessage.id)
    const partBase = () => ({
      id: PartID.ascending(),
      messageID: input.assistantMessage.id,
      sessionID: input.assistantMessage.sessionID,
    })
    let cachedShouldBreak: boolean | undefined
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process started", { sessionId: input.sessionID, command: "session.process", status: "started" })
        needsCompaction = false
        const autonomous = process.env["AX_CODE_AUTONOMOUS"] === "true"
        const shouldBreak = autonomous ? false : (cachedShouldBreak ??= (await Config.get()).experimental?.continue_loop_on_deny !== true)
        while (true) {
          blocked = false
          let currentText: MessageV2.TextPart | undefined
          let reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
          try {
            let usedTools = false
            let stepStartTime = Date.now()
            let stepParts: Array<{ type: "text", text: string } | { type: "reasoning", text: string } | { type: "tool_call", callID: string, tool: string, input: Record<string, unknown> }> = []
            Recorder.emit({
              type: "llm.request",
              sessionID: input.sessionID,
              messageID: input.assistantMessage.id,
              model: `${input.model.providerID}/${input.model.id}`,
              messageCount: streamInput.messages.length,
              stepIndex: attempt,
            })
            const stream = await LLM.stream(streamInput)

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted()
              switch (value.type) {
                case "start":
                  await SessionStatus.set(input.sessionID, { type: "busy" })
                  break

                case "reasoning-start":
                  if (value.id in reasoningMap) {
                    continue
                  }
                  const reasoningPart = {
                    ...partBase(),
                    type: "reasoning" as const,
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  reasoningMap[value.id] = reasoningPart
                  await Session.updatePart.force(reasoningPart)
                  break

                case "reasoning-delta":
                  if (value.id in reasoningMap) {
                    const part = reasoningMap[value.id]
                    part.text += value.text
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    deltaBatcher.push(part.id, value.text)
                  }
                  break

                case "reasoning-end":
                  if (value.id in reasoningMap) {
                    deltaBatcher.flush()
                    const part = reasoningMap[value.id]
                    part.text = part.text.trimEnd()

                    part.time = {
                      ...part.time,
                      end: Date.now(),
                    }
                    if (value.providerMetadata) part.metadata = value.providerMetadata
                    stepParts.push({ type: "reasoning", text: part.text })
                    await Session.updatePart.force(part)
                    delete reasoningMap[value.id]
                  }
                  break

                case "tool-input-start":
                  usedTools = true
                  const base = partBase()
                  const part = await Session.updatePart.force({
                    ...base,
                    id: toolcalls[value.id]?.id ?? base.id,
                    type: "tool",
                    tool: value.toolName,
                    callID: value.id,
                    state: {
                      status: "pending",
                      input: {},
                      raw: "",
                    },
                  })
                  toolcalls[value.id] = part as MessageV2.ToolPart
                  break

                case "tool-input-delta":
                  break

                case "tool-input-end":
                  break

                case "tool-call": {
                  usedTools = true
                  stepParts.push({ type: "tool_call", callID: value.toolCallId, tool: value.toolName, input: value.input as Record<string, unknown> })
                  Recorder.emit({
                    type: "tool.call",
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.id,
                    tool: value.toolName,
                    callID: value.toolCallId,
                    input: value.input as Record<string, unknown>,
                    stepIndex: attempt,
                  })
                  const match = toolcalls[value.toolCallId]
                  if (match) {
                    const part = await Session.updatePart.force({
                      ...match,
                      tool: value.toolName,
                      state: {
                        status: "running",
                        input: value.input,
                        time: {
                          start: Date.now(),
                        },
                      },
                      metadata: value.providerMetadata,
                    })
                    toolcalls[value.toolCallId] = part as MessageV2.ToolPart

                    // Doom loop detection: check ring buffer of recently completed tools plus current call
                    const inputStr = canonicalize(value.input)
                    toolInputCache[value.toolCallId] = inputStr
                    const allRecent = [...recentToolRing, { tool: value.toolName, input: inputStr }]
                    if (
                      allRecent.length >= DOOM_LOOP_THRESHOLD &&
                      allRecent.slice(-DOOM_LOOP_THRESHOLD).every(
                        (p) => p.tool === value.toolName && p.input === inputStr,
                      )
                    ) {
                      if (autonomous) {
                        // In autonomous mode, skip Permission.ask() (which
                        // would auto-approve and waste the detection). Clear
                        // the ring buffer so the tool call proceeds this time
                        // but the detector rearms for the next batch. The
                        // model sees the identical results in its history
                        // which should prompt a strategy change. Step limits
                        // bound total damage if the model keeps repeating.
                        log.warn("autonomous doom_loop detected, clearing ring buffer", { tool: value.toolName, sessionID: input.sessionID })
                        recentToolRing.length = 0
                        break
                      }
                      // `Agent.get()` returns undefined if the agent
                      // was removed or renamed mid-session (e.g. via
                      // config reload). Accessing `.permission` on
                      // undefined would crash the entire processor
                      // pipeline mid-loop. An empty ruleset falls
                      // through to the default "ask" behavior, which
                      // is the same semantic the full ruleset would
                      // have for a doom_loop permission that isn't
                      // explicitly allowed — the user sees the prompt
                      // either way. See BUG-68.
                      const agent = await Agent.get(input.assistantMessage.agent)
                      await Permission.ask({
                        permission: "doom_loop",
                        patterns: [value.toolName],
                        sessionID: input.assistantMessage.sessionID,
                        metadata: {
                          tool: value.toolName,
                          input: value.input,
                        },
                        always: [value.toolName],
                        ruleset: agent?.permission ?? [],
                      })
                    }
                  }
                  break
                }
                case "tool-result": {
                  usedTools = true
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    const toolEndTime = Date.now()
                    await Session.updatePart.force({
                      ...match,
                      state: {
                        status: "completed",
                        input: value.input ?? match.state.input,
                        output: value.output.output,
                        metadata: value.output.metadata,
                        title: value.output.title,
                        time: {
                          start: match.state.time.start,
                          end: toolEndTime,
                        },
                        attachments: value.output.attachments,
                      },
                    })
                    Recorder.emit({
                      type: "tool.result",
                      sessionID: input.sessionID,
                      messageID: input.assistantMessage.id,
                      tool: match.tool,
                      callID: value.toolCallId,
                      status: "completed",
                      output: typeof value.output.output === "string" ? value.output.output.slice(0, 1000) : undefined,
                      durationMs: toolEndTime - match.state.time.start,
                      stepIndex: attempt,
                      deterministic: false,
                    })

                    // Self-correction: clear retry budget on success
                    SelfCorrection.recordSuccess(input.sessionID, match.tool)

                    recentToolRing.push({ tool: match.tool, input: toolInputCache[value.toolCallId] ?? JSON.stringify(value.input ?? match.state.input) })
                    if (recentToolRing.length > DOOM_LOOP_THRESHOLD) recentToolRing.shift()
                    delete toolcalls[value.toolCallId]
                    delete toolInputCache[value.toolCallId]
                  }
                  break
                }

                case "tool-error": {
                  usedTools = true
                  const match = toolcalls[value.toolCallId]
                  if (match && match.state.status === "running") {
                    const errorMsg = value.error instanceof Error ? value.error.message : String(value.error)
                    const toolErrorEnd = Date.now()

                    // Self-correction: analyze the failure BEFORE persisting
                    // the tool error so we can append the reflection prompt
                    // to the error message the LLM sees. Previously the
                    // prompt was computed but discarded, making the whole
                    // self-correction feature a no-op — the log showed
                    // "self-correction active" but the model received no
                    // guidance on its next turn.
                    let annotatedError = errorMsg
                    if (
                      !(value.error instanceof Permission.RejectedError) &&
                      !(value.error instanceof Question.RejectedError)
                    ) {
                      const correction = SelfCorrection.analyze(input.sessionID, match.tool, errorMsg)
                      if (correction) {
                        log.info("self-correction active", {
                          tool: match.tool,
                          strategy: correction.signal.strategy,
                          attempt: correction.signal.attempt,
                        })
                        annotatedError = `${errorMsg}\n\n<system-reminder>\n${correction.prompt}\n</system-reminder>`
                      }
                    }

                    await Session.updatePart.force({
                      ...match,
                      state: {
                        status: "error",
                        input: value.input ?? match.state.input,
                        error: annotatedError,
                        time: {
                          start: match.state.time.start,
                          end: toolErrorEnd,
                        },
                      },
                    })
                    Recorder.emit({
                      type: "tool.result",
                      sessionID: input.sessionID,
                      messageID: input.assistantMessage.id,
                      tool: match.tool,
                      callID: value.toolCallId,
                      status: "error",
                      error: errorMsg.slice(0, 1000),
                      durationMs: toolErrorEnd - match.state.time.start,
                      stepIndex: attempt,
                      deterministic: false,
                    })

                    if (
                      value.error instanceof Permission.RejectedError ||
                      value.error instanceof Question.RejectedError
                    ) {
                      blocked = shouldBreak
                    }
                    recentToolRing.push({ tool: match.tool, input: toolInputCache[value.toolCallId] ?? JSON.stringify(value.input ?? match.state.input) })
                    if (recentToolRing.length > DOOM_LOOP_THRESHOLD) recentToolRing.shift()
                    delete toolcalls[value.toolCallId]
                    delete toolInputCache[value.toolCallId]
                  }
                  break
                }
                case "error":
                  throw value.error

                case "start-step":
                  usedTools = false
                  snapshot = undefined
                  stepStartTime = Date.now()
                  stepParts = []
                  Recorder.emit({
                    type: "step.start",
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.id,
                    stepIndex: attempt,
                  })
                  await Session.updatePart.force({
                    ...partBase(),
                    snapshot,
                    type: "step-start",
                  })
                  break

                case "finish-step":
                  if (!value.usage || ((value.usage.inputTokens ?? 0) === 0 && (value.usage.outputTokens ?? 0) === 0))
                    log.warn("provider returned no usage data", { provider: input.model.providerID, model: input.model.id })
                  const usage = Session.getUsage({
                    model: input.model,
                    usage: value.usage ?? { inputTokens: 0, outputTokens: 0 },
                    metadata: value.providerMetadata,
                  })
                  const finishReason = typeof value.finishReason === "string"
                    ? value.finishReason
                    : (value.finishReason as { type?: string })?.type ?? String(value.finishReason ?? "stop")
                  input.assistantMessage.finish = usedTools ? "tool-calls" : finishReason
                  input.assistantMessage.tokens = {
                    total: (usage.tokens.total ?? 0) + (input.assistantMessage.tokens.total ?? 0),
                    input: usage.tokens.input + input.assistantMessage.tokens.input,
                    output: usage.tokens.output + input.assistantMessage.tokens.output,
                    reasoning: usage.tokens.reasoning + input.assistantMessage.tokens.reasoning,
                    cache: {
                      read: usage.tokens.cache.read + input.assistantMessage.tokens.cache.read,
                      write: usage.tokens.cache.write + input.assistantMessage.tokens.cache.write,
                    },
                  }
                  if (usedTools) snapshot = await Snapshot.track()
                  // Resolve async snapshot patch before batching synchronous DB writes
                  const stepSnapshot = snapshot
                  let patchData: { hash: string; files: string[] } | undefined
                  if (snapshot) {
                    const patch = await Snapshot.patch(snapshot)
                    if (patch.files.length) patchData = patch
                    snapshot = undefined
                  }
                  // Batch step-finish + message update + patch in one transaction
                  Database.transaction(() => {
                    Session.updatePart.force({
                      id: PartID.ascending(),
                      reason: usedTools ? "tool-calls" : finishReason,
                      snapshot: stepSnapshot,
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "step-finish",
                      tokens: usage.tokens,
                    })
                    Session.updateMessage.force(input.assistantMessage)
                    if (patchData) {
                      Session.updatePart.force({
                        ...partBase(),
                        type: "patch",
                        hash: patchData.hash,
                        files: patchData.files,
                      })
                    }
                  })
                  Recorder.emit({
                    type: "step.finish",
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.id,
                    stepIndex: attempt,
                    finishReason: usedTools ? "tool-calls" : finishReason,
                    tokens: {
                      input: usage.tokens.input,
                      output: usage.tokens.output,
                      reasoning: usage.tokens.reasoning,
                      cache: usage.tokens.cache,
                    },
                  })
                  Recorder.emit({
                    type: "llm.response",
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.id,
                    finishReason: usedTools ? "tool-calls" : finishReason,
                    tokens: {
                      input: usage.tokens.input,
                      output: usage.tokens.output,
                      reasoning: usage.tokens.reasoning,
                      cache: usage.tokens.cache,
                    },
                    latencyMs: Date.now() - stepStartTime,
                    stepIndex: attempt,
                  })
                  if (stepParts.length > 0) {
                    Recorder.emit({
                      type: "llm.output",
                      sessionID: input.sessionID,
                      messageID: input.assistantMessage.id,
                      stepIndex: attempt,
                      parts: stepParts,
                    })
                  }
                  SessionSummary.summarize({
                    sessionID: input.sessionID,
                    messageID: input.assistantMessage.parentID,
                  }, input.messages).catch((e) => log.warn("summarize failed", { error: e }))
                  if (
                    !input.assistantMessage.summary &&
                    (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model }))
                  ) {
                    needsCompaction = true
                  }
                  break

                case "text-start":
                  currentText = {
                    ...partBase(),
                    type: "text",
                    text: "",
                    time: {
                      start: Date.now(),
                    },
                    metadata: value.providerMetadata,
                  }
                  await Session.updatePart.force(currentText)
                  break

                case "text-delta":
                  if (currentText) {
                    currentText.text += value.text
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    deltaBatcher.push(currentText.id, value.text)
                  }
                  break

                case "text-end":
                  if (currentText) {
                    deltaBatcher.flush()
                    currentText.text = currentText.text.trimEnd()
                    const textOutput = await Plugin.trigger(
                      "experimental.text.complete",
                      {
                        sessionID: input.sessionID,
                        messageID: input.assistantMessage.id,
                        partID: currentText.id,
                      },
                      { text: currentText.text },
                    )
                    currentText.text = textOutput.text
                    currentText.time = {
                      start: currentText.time?.start ?? Date.now(),
                      end: Date.now(),
                    }
                    if (value.providerMetadata) currentText.metadata = value.providerMetadata
                    stepParts.push({ type: "text", text: currentText.text })
                    await Session.updatePart.force(currentText)
                  }
                  currentText = undefined
                  break

                case "finish":
                  break

                default:
                  log.info("unhandled", {
                    ...value,
                  })
                  continue
              }
              if (needsCompaction) {
                // Finalize in-flight parts before breaking for compaction
                if (currentText) {
                  currentText.text = currentText.text.trimEnd()
                  if (!currentText.time?.end) currentText.time = { start: currentText.time?.start ?? Date.now(), end: Date.now() }
                }
                for (const part of Object.values(reasoningMap)) {
                  part.text = part.text.trimEnd()
                  if (!part.time?.end) part.time = { start: part.time?.start ?? Date.now(), end: Date.now() }
                }
                break
              }
            }
          } catch (e: unknown) {
            deltaBatcher.flush()
            for (const k of Object.keys(toolInputCache)) delete toolInputCache[k]
            if (currentText) {
              currentText.text = currentText.text.trimEnd()
              currentText.time = {
                start: currentText.time?.start ?? Date.now(),
                end: Date.now(),
              }
            }
            for (const part of Object.values(reasoningMap)) {
              part.text = part.text.trimEnd()
              part.time = {
                start: part.time?.start ?? Date.now(),
                end: Date.now(),
              }
            }
            // Batch error-recovery writes in one transaction
            const errorParts = [
              ...(currentText ? [currentText] : []),
              ...Object.values(reasoningMap),
            ]
            if (errorParts.length > 0) {
              Database.transaction(() => {
                for (const p of errorParts) Session.updatePart.force(p)
              })
            }
            const errStack = e instanceof Error ? e.stack : undefined
            const errName = e instanceof Error ? e.name : (e as { constructor?: { name?: string } })?.constructor?.name
            const errMessage = e instanceof Error ? e.message : String(e)
            log.error("process failed", {
              sessionId: input.sessionID,
              command: "session.process",
              status: "error",
              errorCode: errName ?? "Unknown",
              error: e,
              stack: JSON.stringify(errStack),
            })
            Recorder.emit({
              type: "error",
              sessionID: input.sessionID,
              messageID: input.assistantMessage.id,
              errorType: errName ?? "Unknown",
              message: errMessage.slice(0, 2000),
              stepIndex: attempt,
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            if (MessageV2.ContextOverflowError.isInstance(error)) {
              needsCompaction = true
              Bus.publish(Session.Event.Error, {
                sessionID: input.sessionID,
                error,
              })
            } else {
              const retry = SessionRetry.retryable(error)
              if (retry !== undefined) {
                attempt++
                if (attempt <= SessionRetry.RETRY_MAX_ATTEMPTS) {
                  const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
                  await SessionStatus.set(input.sessionID, {
                    type: "retry",
                    attempt,
                    message: retry,
                    next: Date.now() + delay,
                  })
                  await SessionRetry.sleep(delay, input.abort).catch(() => {})
                  if (input.abort.aborted) break
                  continue
                }
                input.assistantMessage.error = MessageV2.APIError.isInstance(error)
                  ? new MessageV2.APIError({
                      ...error.data,
                      isRetryable: false,
                      message: `${error.data.message} (stopped after ${SessionRetry.RETRY_MAX_ATTEMPTS} retries)`,
                    }).toObject()
                  : new NamedError.Unknown({
                      message: `${retry} (stopped after ${SessionRetry.RETRY_MAX_ATTEMPTS} retries)`,
                    }).toObject()
              } else {
                input.assistantMessage.error ??= error
              }
              Bus.publish(Session.Event.Error, {
                sessionID: input.assistantMessage.sessionID,
                error: input.assistantMessage.error,
              })
              await SessionStatus.set(input.sessionID, { type: "idle" })
            }
          }
          // Resolve async snapshot before batching final DB writes
          let finalPatch: { hash: string; files: string[] } | undefined
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) finalPatch = patch
            snapshot = undefined
          }
          // Batch final cleanup writes in one transaction
          input.assistantMessage.time.completed = Date.now()
          Database.transaction(() => {
            if (finalPatch) {
              Session.updatePart.force({
                id: PartID.ascending(),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: finalPatch.hash,
                files: finalPatch.files,
              })
            }
            // Use local toolcalls record instead of DB query to find incomplete tools
            for (const part of Object.values(toolcalls)) {
              if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
                Session.updatePart.force({
                  ...part,
                  state: {
                    ...part.state,
                    status: "error",
                    error: "Tool execution aborted",
                    time: {
                      start: part.state.status === "running" && "time" in part.state
                        ? part.state.time.start
                        : Date.now(),
                      end: Date.now(),
                    },
                  },
                })
              }
            }
            Session.updateMessage.force(input.assistantMessage)
          })
          deltaBatcher.flush()
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
