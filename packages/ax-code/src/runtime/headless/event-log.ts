import { isHeadlessRuntimeEvent, type HeadlessRuntimeEvent } from "./event"

export function encodeHeadlessEventLogRecord(record: unknown) {
  const encoded = JSON.stringify(record)
  return `${encoded ?? "null"}\n`
}

export function decodeHeadlessEventLogRecord<
  TSession extends { id: string } = { id: string },
  TTodo = unknown,
  TDiff = unknown,
  TStatus = unknown,
  TMessage extends { id: string; sessionID: string } = { id: string; sessionID: string },
  TPart extends { id: string; messageID: string } = { id: string; messageID: string },
>(record: unknown): HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart> | undefined {
  const candidate = eventCandidate(record)
  if (!isHeadlessRuntimeEvent(candidate)) return undefined
  return candidate as HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart>
}

export function decodeHeadlessEventLogLine<
  TSession extends { id: string } = { id: string },
  TTodo = unknown,
  TDiff = unknown,
  TStatus = unknown,
  TMessage extends { id: string; sessionID: string } = { id: string; sessionID: string },
  TPart extends { id: string; messageID: string } = { id: string; messageID: string },
>(line: string): HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart> | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  try {
    return decodeHeadlessEventLogRecord<TSession, TTodo, TDiff, TStatus, TMessage, TPart>(JSON.parse(trimmed))
  } catch {
    return undefined
  }
}

function eventCandidate(record: unknown) {
  if (!record || typeof record !== "object") return record
  return (record as { details?: unknown }).details ?? record
}
