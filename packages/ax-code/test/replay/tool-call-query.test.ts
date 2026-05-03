import { describe, expect, test } from "bun:test"
import { ToolCallReplayQuery } from "@/replay/tool-call-query"

describe("ToolCallReplayQuery", () => {
  test("summarizes open tool calls from replay events", () => {
    const summary = ToolCallReplayQuery.summaryFromEvents([
      {
        type: "tool.call",
        tool: "read",
        callID: "call_read",
        input: { filePath: "a.ts" },
        stepIndex: 0,
      },
      {
        type: "tool.result",
        tool: "read",
        callID: "call_read",
        status: "completed",
      },
      {
        type: "tool.call",
        tool: "task",
        callID: "call_task",
        input: { subagent_type: "explore" },
        stepIndex: 1,
      },
    ])

    expect(summary.totalCalls).toBe(2)
    expect(summary.totalResults).toBe(1)
    expect(summary.openCalls.map((call) => call.callID)).toEqual(["call_task"])
    expect(summary.openTaskCalls.map((call) => call.tool)).toEqual(["task"])
  })

  test("preserves replay row timestamps for open calls", () => {
    expect(
      ToolCallReplayQuery.summaryFromRows([
        {
          event_data: {
            type: "tool.call",
            tool: "task",
            callID: "call_task",
          },
          time_created: 123,
        },
      ]).openCalls[0]?.timeCreated,
    ).toBe(123)
  })
})
