import type { ReplayEvent } from "./event"

type ToolCallEvent = Extract<ReplayEvent, { type: "tool.call" }>

export namespace ToolCallReplayQuery {
  export interface TimelineRow {
    event_data: unknown
    time_created?: number
  }

  export interface OpenToolCall {
    callID: string
    tool: string
    sequence: number
    stepIndex?: number
    messageID?: string
    input?: Record<string, unknown>
    timeCreated?: number
    event: ToolCallEvent
  }

  export interface Summary {
    totalCalls: number
    totalResults: number
    openCalls: OpenToolCall[]
    openTaskCalls: OpenToolCall[]
  }

  export function summaryFromRows(rows: readonly TimelineRow[]): Summary {
    return summarize(
      rows.map((row, sequence) => ({
        event: row.event_data,
        sequence,
        timeCreated: row.time_created,
      })),
    )
  }

  export function summaryFromEvents(events: readonly unknown[]): Summary {
    return summarize(events.map((event, sequence) => ({ event, sequence })))
  }

  function summarize(entries: readonly { event: unknown; sequence: number; timeCreated?: number }[]): Summary {
    const calls = new Map<string, OpenToolCall>()
    let totalCalls = 0
    let totalResults = 0

    for (const entry of entries) {
      const event = asRecord(entry.event)
      const type = asString(event.type)
      if (type === "tool.call") {
        const callID = asString(event.callID)
        const tool = asString(event.tool)
        if (!callID || !tool) continue
        totalCalls++
        calls.set(callID, {
          callID,
          tool,
          sequence: entry.sequence,
          stepIndex: typeof event.stepIndex === "number" ? event.stepIndex : undefined,
          messageID: asString(event.messageID),
          input: asInput(event.input),
          timeCreated: entry.timeCreated,
          event: entry.event as ToolCallEvent,
        })
        continue
      }
      if (type === "tool.result") {
        const callID = asString(event.callID)
        if (!callID) continue
        totalResults++
        calls.delete(callID)
      }
    }

    const openCalls = [...calls.values()].toSorted((a, b) => a.sequence - b.sequence)
    return {
      totalCalls,
      totalResults,
      openCalls,
      openTaskCalls: openCalls.filter((call) => call.tool === "task"),
    }
  }

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  }

  function asString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined
  }

  function asInput(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  }
}
