import { expect, test } from "vitest"
import { compareEventTypes } from "../../src/cli/cmd/compare"

test("compareEventTypes returns sorted unique event types from both sessions", () => {
  expect(compareEventTypes({ "tool.call": 2, "agent.route": 1 }, { "session.start": 1, "tool.call": 1 })).toEqual([
    "agent.route",
    "session.start",
    "tool.call",
  ])
})
