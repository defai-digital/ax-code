import { describe, expect, test } from "vitest"
import type { MessageV2 } from "../../src/session/message-v2"
import { goalBlockerEvidence } from "../../src/session/goal-blocker"

const GOAL_CREATED = 1_000

function assistant(
  id: string,
  created: number,
  parts: Array<{ id: string; tool: string; status: "completed" | "error"; end: number }>,
): MessageV2.WithParts {
  return {
    info: { id, role: "assistant", time: { created } },
    parts: parts.map((part) => ({
      id: part.id,
      type: "tool",
      tool: part.tool,
      state: { status: part.status, time: { start: created, end: part.end } },
    })),
  } as unknown as MessageV2.WithParts
}

describe("goalBlockerEvidence", () => {
  test("cites a tool result that finished after the goal even when its message started earlier", () => {
    // The message that creates the goal runs a failing command in the same
    // step: time.created predates the goal, the tool's end does not.
    const evidence = goalBlockerEvidence(
      [assistant("msg_create", 500, [{ id: "part_failed", tool: "bash", status: "error", end: 1_500 }])],
      GOAL_CREATED,
    )

    expect(evidence.map((item) => item.id)).toContain("part_failed")
  })

  test("excludes a tool result that finished before the goal", () => {
    const evidence = goalBlockerEvidence(
      [
        assistant("msg_early", 200, [{ id: "part_early", tool: "bash", status: "completed", end: 400 }]),
        assistant("msg_late", 1_200, [{ id: "part_late", tool: "bash", status: "completed", end: 1_300 }]),
      ],
      GOAL_CREATED,
    )

    expect(evidence.map((item) => item.id)).toEqual(["part_late"])
  })

  test("ignores admin tools and unfinished states", () => {
    const evidence = goalBlockerEvidence(
      [
        assistant("msg_admin", 1_200, [
          { id: "part_admin", tool: "update_goal", status: "completed", end: 1_300 },
          { id: "part_ok", tool: "read", status: "completed", end: 1_400 },
        ]),
      ],
      GOAL_CREATED,
    )

    expect(evidence.map((item) => item.id)).toEqual(["part_ok"])
  })
})
