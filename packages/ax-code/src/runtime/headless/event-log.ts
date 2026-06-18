import { isHeadlessRuntimeEvent, type HeadlessRuntimeEvent } from "./event"
import { parseJsonPayload } from "@/util/json-value"
import { toErrorMessage } from "@/util/error-message"

export function encodeHeadlessEventLogRecord(record: unknown) {
  const encoded = stringifyHeadlessEventLogRecord(record)
  return `${encoded ?? "null"}\n`
}

function stringifyHeadlessEventLogRecord(record: unknown) {
  const seen = new WeakSet<object>()
  try {
    return JSON.stringify(record, (_key, value) => {
      if (typeof value === "bigint") return value.toString()
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]"
        seen.add(value)
      }
      return value
    })
  } catch (error) {
    return JSON.stringify({
      type: "headless.event_log.serialization_error",
      error: toErrorMessage(error),
    })
  }
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

export function parseHeadlessEventLogJsonLine(line: string): unknown | undefined {
  return parseJsonPayload(line)
}

export function decodeHeadlessEventLogLine<
  TSession extends { id: string } = { id: string },
  TTodo = unknown,
  TDiff = unknown,
  TStatus = unknown,
  TMessage extends { id: string; sessionID: string } = { id: string; sessionID: string },
  TPart extends { id: string; messageID: string } = { id: string; messageID: string },
>(line: string): HeadlessRuntimeEvent<TSession, TTodo, TDiff, TStatus, TMessage, TPart> | undefined {
  const record = parseHeadlessEventLogJsonLine(line)
  if (record === undefined) return undefined
  return decodeHeadlessEventLogRecord<TSession, TTodo, TDiff, TStatus, TMessage, TPart>(record)
}

function eventCandidate(record: unknown) {
  if (!record || typeof record !== "object") return record
  return (record as { details?: unknown }).details ?? record
}
