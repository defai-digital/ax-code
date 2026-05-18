import { decodeHeadlessEventLogLine, decodeHeadlessEventLogRecord } from "./event-log"
import { createHeadlessProjectionState, applyHeadlessProjectionEvent, type HeadlessProjectionState } from "./projection"
import type { HeadlessRuntimeEvent } from "./event"

export type HeadlessReplayInput<
  TSession extends { id: string } = { id: string },
  TTodo = unknown,
  TDiff = unknown,
  TStatus = unknown,
  TMessage extends { id: string; sessionID: string } = { id: string; sessionID: string },
  TPart extends { id: string; messageID: string } = { id: string; messageID: string },
  TRisk = unknown,
> = {
  events:
    | Iterable<HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart> | unknown>
    | AsyncIterable<HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart> | unknown>
  initialState?: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>
  onEvent?: (
    event: HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>,
    state: HeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>,
  ) => void | Promise<void>
}

export async function replayHeadlessEvents<
  TSession extends { id: string } = { id: string },
  TTodo = unknown,
  TDiff = unknown,
  TStatus = unknown,
  TMessage extends { id: string; sessionID: string } = { id: string; sessionID: string },
  TPart extends { id: string; messageID: string } = { id: string; messageID: string },
  TRisk = unknown,
>(input: HeadlessReplayInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>) {
  const state =
    input.initialState ?? createHeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>()

  for await (const record of toAsyncIterable(input.events)) {
    const event = decodeHeadlessEventLogRecord<TSession, TTodo, TDiff, TStatus, TMessage, TPart>(record)
    if (!event) continue
    applyHeadlessProjectionEvent(state, event)
    await input.onEvent?.(event, state)
  }

  return state
}

export type HeadlessEventLogReplayInput<
  TSession extends { id: string } = { id: string },
  TTodo = unknown,
  TDiff = unknown,
  TStatus = unknown,
  TMessage extends { id: string; sessionID: string } = { id: string; sessionID: string },
  TPart extends { id: string; messageID: string } = { id: string; messageID: string },
  TRisk = unknown,
> = Omit<HeadlessReplayInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>, "events"> & {
  lines: Iterable<string> | AsyncIterable<string>
}

export async function replayHeadlessEventLogLines<
  TSession extends { id: string } = { id: string },
  TTodo = unknown,
  TDiff = unknown,
  TStatus = unknown,
  TMessage extends { id: string; sessionID: string } = { id: string; sessionID: string },
  TPart extends { id: string; messageID: string } = { id: string; messageID: string },
  TRisk = unknown,
>(input: HeadlessEventLogReplayInput<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>) {
  const state =
    input.initialState ?? createHeadlessProjectionState<TSession, TTodo, TDiff, TStatus, TMessage, TPart, TRisk>()

  for await (const line of toAsyncIterable(input.lines)) {
    const event = decodeHeadlessEventLogLine<TSession, TTodo, TDiff, TStatus, TMessage, TPart>(line)
    if (!event) continue
    applyHeadlessProjectionEvent(state, event)
    await input.onEvent?.(event, state)
  }

  return state
}

async function* toAsyncIterable<T>(items: Iterable<T> | AsyncIterable<T>) {
  if (isAsyncIterable(items)) {
    for await (const item of items) yield item
    return
  }

  for (const item of items) yield item
}

function isAsyncIterable<T>(items: Iterable<T> | AsyncIterable<T>): items is AsyncIterable<T> {
  return typeof (items as AsyncIterable<T>)[Symbol.asyncIterator] === "function"
}
