import { encodeHeadlessEventLogRecord } from "./event-log"

export type HeadlessEventSink = {
  write: (record: unknown) => void | Promise<void>
  close?: () => void | Promise<void>
}

export function createHeadlessJsonlEventSink(writeLine: (line: string) => void | Promise<void>): HeadlessEventSink {
  return {
    write(record) {
      return writeLine(encodeHeadlessEventLogRecord(record))
    },
  }
}

export function createHeadlessCompositeEventSink(sinks: readonly HeadlessEventSink[]): HeadlessEventSink {
  return {
    async write(record) {
      for (const sink of sinks) await sink.write(record)
    },
    async close() {
      for (const sink of [...sinks].reverse()) await sink.close?.()
    },
  }
}

export async function writeHeadlessEventSink(sink: HeadlessEventSink | undefined, record: unknown) {
  if (!sink) return
  await sink.write(record)
}

export async function closeHeadlessEventSink(sink: HeadlessEventSink | undefined) {
  await sink?.close?.()
}
