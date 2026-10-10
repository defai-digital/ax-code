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
      // Close every sink even when one fails, so a broken sink cannot leak the
      // resources of the sinks opened before it; report the first failure.
      const failures: unknown[] = []
      for (const sink of [...sinks].reverse()) {
        try {
          await sink.close?.()
        } catch (error) {
          failures.push(error)
        }
      }
      if (failures.length > 0) throw failures[0]
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
