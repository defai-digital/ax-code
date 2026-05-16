import type { Event } from "@ax-code/sdk/v2"
import type { HeadlessRuntimeCommand } from "./command"
import {
  executeHeadlessProjectionEffects,
  type HeadlessProjectionEffectHandlers,
} from "./effects"
import { decodeHeadlessEventLogRecord } from "./event-log"
import { closeHeadlessEventSink, writeHeadlessEventSink, type HeadlessEventSink } from "./event-sink"
import type { HeadlessRuntimeEvent } from "./event"
import {
  applyHeadlessProjectionEvent,
  createHeadlessProjectionState,
  type HeadlessProjectionApplyResult,
  type HeadlessProjectionState,
} from "./projection"
import {
  createHeadlessAgentRuntime,
  type HeadlessAgentRuntime,
  type HeadlessAgentRuntimeInput,
} from "./runtime"

export type HeadlessRuntimeEventDecoder<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
> = (event: Event) => HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart> | undefined

export type HeadlessSessionRunnerInput<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
> = HeadlessAgentRuntimeInput & {
  runtime?: HeadlessAgentRuntime
  signal: AbortSignal
  command?: HeadlessRuntimeCommand
  state?: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>
  decodeEvent?: HeadlessRuntimeEventDecoder<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
  effects?: Partial<HeadlessProjectionEffectHandlers>
  eventSink?: HeadlessEventSink
  autonomous?: boolean
  maxSessionMessages?: number
  stopWhen?: (input: {
    event: HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
    state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>
    result: HeadlessProjectionApplyResult
  }) => boolean
  onEvent?: (input: {
    rawEvent: Event
    event: HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
    state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>
    result: HeadlessProjectionApplyResult
  }) => void | Promise<void>
  onRawEvent?: (event: Event) => void | Promise<void>
}

export type HeadlessSessionRunnerResult<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
> = {
  state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>
  stopped: "signal" | "predicate"
}

export async function runHeadlessSession<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
  TRisk = unknown,
>(
  input: HeadlessSessionRunnerInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>,
): Promise<HeadlessSessionRunnerResult<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>> {
  const runtime = input.runtime ?? createHeadlessAgentRuntime(input)
  const state =
    input.state ??
    createHeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>()
  const controller = new AbortController()
  const stopFromSignal = () => controller.abort(input.signal.reason)
  input.signal.addEventListener("abort", stopFromSignal, { once: true })
  let stopped: HeadlessSessionRunnerResult<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>["stopped"] =
    "signal"

  try {
    const subscription = runtime.subscribe({
      signal: controller.signal,
      onEvent: async (rawEvent) => {
        await writeHeadlessEventSink(input.eventSink, rawEvent)
        await input.onRawEvent?.(rawEvent)
        const event = (input.decodeEvent ?? defaultHeadlessRuntimeEventDecoder)(rawEvent)
        if (!event) return

        const result = applyHeadlessProjectionEvent(state, event, {
          autonomous: input.autonomous,
          maxSessionMessages: input.maxSessionMessages,
        })
        executeHeadlessProjectionEffects(result.effects, {
          ...input.effects,
          onWarn: input.effects?.onWarn ?? (() => {}),
        })
        await input.onEvent?.({ rawEvent, event, state, result })

        if (input.stopWhen?.({ event, state, result })) {
          stopped = "predicate"
          controller.abort()
        }
      },
    })

    try {
      if (input.command) await runtime.send(input.command)
      await subscription
    } catch (error) {
      if (!controller.signal.aborted) controller.abort()
      await subscription.catch(() => {})
      throw error
    }
  } finally {
    if (!controller.signal.aborted) controller.abort()
    await closeHeadlessEventSink(input.eventSink)
    input.signal.removeEventListener("abort", stopFromSignal)
  }

  return { state, stopped }
}

export function defaultHeadlessRuntimeEventDecoder<
  TSession extends { id: string },
  TTodo,
  TDiff,
  TStatus,
  TMessage extends { id: string; sessionID: string },
  TPart extends { id: string; messageID: string },
>(event: Event): HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart> | undefined {
  return decodeHeadlessEventLogRecord(event) as
    | HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
    | undefined
}
